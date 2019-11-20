var client = require('./client');
var config = require('../config');
var c = require('../common');
var _ = require('lodash');
var buildkite = require('../buildkite/buildkite');
var pullrequest = require('../pullrequest/pullrequest');
var constants = require('../constants');

const addComment = async (pr, body) => {
    const mutation = `
        mutation {
            addComment(input: {
                body: "${body}",
                subjectId: ${pr.id}
            }) {subject{id}}
        }`;
    return await client.mutate(mutation);
};
exports.addComment = addComment;

exports.getUsername = async () => {
    query = `
        query {
            viewer {
                login
                name
            }
        }
    `;

    return (await client.query(query)).body.data.viewer.login;
};

const mergePullRequest = async pr => {
    // const mutation = `
    //     mutation {
    //         mergePullRequest(input: {
    //             pullRequestId: ${pr.id}
    //         }) {
    //             pullRequest {
    //                 title
    //                 merged
    //                 closed
    //             }
    //         }
    //     }
    // `;

    // worst case if this doesn't work, we'll drop to v3 api.
    // https://developer.github.com/v3/pulls/#merge-a-pull-request-merge-button
    // return await client.mutate(mutation);

    try {
        console.log('attempting merge on ', pr.title);
        // v4 of the api doesn't support rebase flows. drop to v3 for this.
        const uri = `/repos/${config.secrets.repoowner}/${config.secrets.repo}/pulls/${pr.number}/merge`;
        return await client.v3request({
            method: 'PUT',
            uri,
            data: {
                merge_method: 'rebase',
            },
        });
    } catch (err) {
        console.log(err);
    }
};

// lol github doesn't like it if you just request the world.
// they have some checks. 100 comments max which is what we're actually
// worried abotu blowing. PRs 40 would probably be sufficient but whatever.
// if you're active in non-samsara repositories, then this might fail for you. :shrug:
// there's just no way I'm dealing with pagination for the time being.
const maxNodes = 100;

// if pullReqs is passed in, this is the identity function.
// useful in case they're being passed around.
const getPrs = async pullReqs => {
    if (pullReqs) {
        return pullReqs;
    }

    // query for open PRs by the viewer (access token based)

    const getQuery = rootQuery => `
        query { 
            ${rootQuery} {
                login 
                name 
                pullRequests(last: ${30}, states:OPEN) {
                    nodes {
                        comments(last: ${maxNodes}) {
                            nodes {
                                author {
                                    login
                                }
                                body
                                createdAt
                                id
                            }
                        }
                        createdAt
                        updatedAt
                        body
                        title
                        number
                        id
                        mergeable
                        mergeStateStatus
                        # canBeRebased
                        headRef {
                            name
                            target {
                                oid
                            }
                        }
                        # base branch so that rebasing can be done properly onto that.
                        baseRef {
                            name
                            target {
                                oid
                            }
                        }
                        headRepository {
                            url
                        }
                        # uh, don't have more than 80 commits? (github has max 250 on this lmao)
                        commits(last: 80) {
                            nodes {
                                commit {
                                    oid
                                    commitUrl
                                    message
                                    # status will be pending since reviewer count is there. 
                                    # probably use checkSuites
                                    status {
                                        state
                                    }
                                }
                            }
                        }
                    }
                }
            } 
        }
    `;

    const allUsers = ['viewer', ...config.extraUsers.map(user => `user(login: "${user}")`)];

    const prSets = await allUsers.mapAsync(async user => {
        const data = (await client.query(getQuery(user))).body.data;
        // different response struct based on viewer or user query.
        const prs = (data.viewer && data.viewer.pullRequests.nodes) || data.user.pullRequests.nodes;
        return prs;
    });

    return prSets.flat();
};

// prs that are open that are in the repo the app is configured for.
// if you don't pass in pullReqs, they'll be queried from github.
const getOpenPrs = async pullReqs => {
    return (await getPrs(pullReqs)).filter(pr => config.gitrepourl.includes(pr.headRepository.url));
};

// shoot me. Github api v4 doesn't have statuses yet -______-. So let's go to v3 and get them.
const getRefStatuses = async sha => {
    return await client.v3request({
        uri: `/repos/${config.secrets.repoowner}/${config.secrets.repo}/commits/${sha}/statuses`,
    });
};

/**
 * Checks for a given PR if it's currently in an actionable state to be fixed up. Sometimes we're still waiting on
 * some status to be able to perform a rebase or commit generated code or whatnot.
 * @param {*} pr
 */
const hasActionableFailingStatus = async pr => {
    const isFailed = t => t.state === 'failure';
    const isPending = t => t.state === 'pending';
    // we actually want the last commit with statuses. sometimes the last commit won't trigger ci.
    // why? deps detection? I'm not actually sure.
    let statuses = null;
    for (let commit of pullrequest.getCommits(pr)) {
        const list = (await getRefStatuses(commit.oid)).body;
        if (c.notEmpty(list)) {
            statuses = list;
            break;
        }
    }

    // we want the backend verifications to have finished so that our git diff applier will always pick up
    // before just random rebasing. A bit hacky to put it in here, but rip. Could do a status check pre rebase.
    // so there's more than one backend verifications (not sure why there are 2). Let's say that all must be
    // pending since one seems to finish and not the other. I'm not going to figure out why there are 2 right now.
    if (statuses.filter(status => status.context.endsWith('golang-backend-verifications')).every(isPending)) {
        console.log(pr.title, 'pending verifications status');
        return false;
    }

    // For a status to be actionable, all statuses of the same name must be failing (if auto-retry in
    // buildkite picked up, we'd like to wait for them all to finish)
    return _.some(_.groupBy(statuses, 'context'), sts => sts.every(isFailed));
};

// github changed recently to actually store more of these as unicode emojis rather
// than the `:...:` format. so let's support both. sigh
const shippedEmojis = [':shipit:', ':sheep:', '🐑'];
const updateMeEmojis = [':fire_engine:', '🚒', ':man_health_worker:', '👨‍⚕'];

const textMatchesString = string => text => text.includes(string);
const textMatchesAnyString = stringSet => text => stringSet.some(s => text.includes(s));

const textMatchesJankIndex = textMatchesString("jank:");
const textMatchesShippit = textMatchesAnyString(shippedEmojis);
const textMatchesUpdate = textMatchesAnyString(updateMeEmojis);

const prsToTriggered = async (textFilter, pullReqs) => {
    const prs = (await getOpenPrs(pullReqs)).filter(pr => {
        return textFilter(pr.body) || pr.comments.nodes.map(c => c.body).some(textFilter);
    });
    return prs;
};

// a pr is shipped if one of the emojis present in any of the comments.
// if you don't pass in pullReqs, they'll be queried from github.
const getShippedPrs = async pullReqs => prsToTriggered(textMatchesShippit, pullReqs);
const getUpdatePrs = async pullReqs => prsToTriggered(textMatchesUpdate, pullReqs);
const getJankIndexUpdatingPrs = async pullReqs => prsToTriggered(textMatchesJankIndex, pullReqs);

// get prs which have a triggering emoji which aren't passing ci. We want to action on those in some way.
const getPrsToFixup = async pullReqs => {
    const pulls = await getOpenPrs(pullReqs);
    // we want to rebase if the last commit has any failing status.
    // pending statuses are ok because some statuses don't resolve until approvals happen.

    // dedupe by id in case a pr is both shipped and fixuped
    const prs = _.uniqBy([...(await getShippedPrs(pulls)), ...(await getUpdatePrs(pulls))], pr => pr.id);
    const failingPrs = await prs.filterAsync(hasActionableFailingStatus);

    // we want to split out ones that are failing generically vs due to gitdiff.
    // so we annotate each pr with the reason it failed.
    const isFailure = await failingPrs.mapAsync(buildkite.isFailingGitDiff);
    failingPrs.forEach((pr, idx) => {
        pr.failureReason = isFailure[idx];
    });

    return _.groupBy(_.orderBy(failingPrs, 'updatedAt', 'desc'), 'failureReason');
};

const getPrsToMerge = async pullReqs => {
    // CLEAN I thiiiink means it's all green. anyway, without reviews it says BLOCKED
    return (await getShippedPrs(pullReqs)).filter(pr => pr.mergeStateStatus === 'CLEAN');
};

const mergePrs = async pullReqs => {
    return (await getPrsToMerge(pullReqs)).mapAsync(async pr => {
        try {
            return await mergePullRequest(pr);
        } catch (err) {
            // ignore errors in the merge to move on to the next one. Will pick up in next main loop
        }
    });
};

exports.getOpenPrs = getOpenPrs;
exports.getShippedPrs = getShippedPrs;
exports.getUpdatePrs = getUpdatePrs;
exports.getPrsToFixup = getPrsToFixup;
exports.getJankIndexUpdatingPrs = getJankIndexUpdatingPrs;
exports.mergePrs = mergePrs;

const getBotState = pr => {
    const prefix = '<!-- simonbot';
    const stateLines = pr.body.split('\n').filter(line => line.startsWith(prefix));
    const events = stateLines.map(line =>
        line
            .slice(prefix.length)
            .trim()
            .split(' ')
            .first()
    );

    return { numRebases: events.filter(e => e === 'rebase').length };
};
exports.getBotState = getBotState;

const appendToBody = async (pr, text) => {
    newBody = pr.body + '\n' + text;
    try {
        const resp = await client.v3request({
            uri: `/repos/${config.secrets.repoowner}/${config.secrets.repo}/pulls/${pr.number}`,
            method: 'PATCH',
            data: { body: newBody },
        });
        // update the body on the pr to reflect what we just set it to. hacky, sorry
        pr.body = newBody;

        return resp;
    } catch (err) {
        // throw errors away. Worst case we rebase an extra few times.
        // the update will potentially fail if the user has updated the body?
    }
};

exports.logRebase = async pr => {
    await appendToBody(pr, '<!-- simonbot rebase -->');
    const { numRebases } = getBotState(pr);
    // if we're over the max number of rebases, then let's comment to indicate that.
    if (numRebases >= constants.MAX_REBASE_ATTEMPTS) {
        await addComment(pr, `🥵 max rebases hit (${constants.MAX_REBASE_ATTEMPTS})`);
    }
};

exports.testAddComment = async () => {
    console.log('test add comment');
    try {
        const { other } = await getPrsToFixup();
        const pr = other.first();
        await addComment(pr, 'test comment');
    } catch (err) {
        console.log(err);
    }
};

exports.test = async () => {
    const query = `
    query {
        repository(name: "${config.secrets.repo}", owner: "${config.secrets.repoowner}") {
            pullRequests(last: ${100}, states:OPEN) {
                nodes {
                    comments(last: ${50}) {
                        nodes {
                            author {
                                login
                            }
                            body
                            createdAt
                            id
                        }
                    }
                    createdAt
                    updatedAt
                    body
                    title
                    number
                    id
                    mergeable
                    mergeStateStatus
                    headRef {
                        name
                        target {
                            oid
                        }
                    }
                    # base branch so that rebasing can be done properly onto that.
                    baseRef {
                        name
                        target {
                            oid
                        }
                    }
                    headRepository {
                        url
                    }
                    # uh, don't have more than 100 commits? (github has max 250 on this lmao)
                    commits(last: ${80}) {
                        nodes {
                            commit {
                                oid
                                commitUrl
                                message
                            }
                        }
                    }
                }
            }
        }
    }
`;

    try {
        const resp = await client.query(query);
        console.log(resp.body.data.repository.pullRequests.nodes);
        return resp;
    } catch (err) {
        console.log(err);
    }
};
