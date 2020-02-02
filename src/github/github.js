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
                subjectId: "${pr.id}"
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

let numSheeps = { numSheeps: 0 };
exports.numSheeps = numSheeps;

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
        // v4 of the api doesn't support rebase flows. drop to v3 for this.
        const uri = `/repos/${config.secrets.repoowner}/${config.secrets.repo}/pulls/${pr.number}/merge`;
        const resp = await client.v3request({
            method: 'PUT',
            uri,
            data: {
                merge_method: 'rebase',
            },
        });
        numSheeps.numSheeps++;
        return resp;
    } catch (err) {
        console.log('failed to merge', pr.title, err);
    }
};

// lol github doesn't like it if you just request the world.
// they have some checks. 100 comments max which is what we're actually
// worried about blowing. PRs 40 would probably be sufficient but whatever.
const maxNodes = 100;

// if pullReqs is passed in, this is the identity function.
// useful in case they're being passed around.
const getPrs = async (pullReqs, getFullList) => {
    if (pullReqs) {
        return pullReqs;
    }

    const startMs = Date.now();

    // NB. we set this to 30. At 50, we were consistently getting 502'ed by github.
    const numPerPage = 30;

    const getQuery = startCursor => `
        query {
            repository(name: "${config.secrets.repo}", owner: "${config.secrets.repoowner}") {
                nameWithOwner
                pullRequests(first: ${numPerPage}, states:OPEN, orderBy: {field: UPDATED_AT, direction: DESC}${
        startCursor ? `, after: "${startCursor}"` : ''
    }) {
                    pageInfo {
                        hasNextPage
                        startCursor
                        endCursor
                    }
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
                        labels(last: ${5}) {
                            nodes{
                                name
                            }
                        }
                        createdAt
                        updatedAt
                        author {
                            login
                        }
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
                        commits(last: ${80}) {
                            nodes {
                                commit {
                                    oid
                                    commitUrl
                                    message
                                    authoredDate
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

    const prs = [];
    let resp = await client.query(getQuery());
    const appendPrs = response => prs.push(...response.body.data.repository.pullRequests.nodes);
    appendPrs(resp);
    const respToCursor = response =>
        (resp.body.data.repository.pullRequests.pageInfo.hasNextPage &&
            resp.body.data.repository.pullRequests.pageInfo.endCursor) ||
        undefined;
    let nextCursor = respToCursor(resp);
    let numErrors = 0;
    while (nextCursor) {
        try {
            resp = await client.query(getQuery(nextCursor));
            appendPrs(resp);

            // we stop at 120prs unless told to get the full list.
            // we use this to reduce latency on most calls, but every so often
            // will check all open PRs.
            if (getFullList || prs.length < 120) {
                nextCursor = respToCursor(resp);
            } else {
                nextCursor = undefined;
            }
        } catch (err) {
            numErrors++;

            if (numErrors > 3) {
                console.log('max errors in pr pagination. working with what we have.');
                console.log(err);
                break;
            } else {
                console.log('error on a page of PRs. retrying');
                console.log(err);
            }
        }
    }

    console.log('getting prs took seconds', (Date.now() - startMs) / 1000);

    if (config.secrets.restrictUsersToFile) {
        // we have all PRs, let's filter to users who are in extra users.
        return prs.filter(pr => config.extraUsers.includes(pr.author.login));
    } else {
        return prs;
    }
};

// prs that are open that are in the repo the app is configured for.
// if you don't pass in pullReqs, they'll be queried from github.
const getOpenPrs = async (pullReqs, getFullList = false) => {
    return (await getPrs(pullReqs, getFullList)).filter(pr => config.gitrepourl.includes(pr.headRepository.url));
};

// shoot me. Github api v4 doesn't have statuses yet -______-. So let's go to v3 and get them.
const getRefStatuses = async sha => {
    return await client.v3request({
        uri: `/repos/${config.secrets.repoowner}/${config.secrets.repo}/commits/${sha}/statuses`,
    });
};

const approvePr = async pr => {
    const createResp = await client.v3request({
        uri: `/repos/${config.secrets.repoowner}/${config.secrets.repo}/pulls/${pr.number}/reviews`,
        method: 'POST',
        data: { body: 'sheepy approved', event: 'APPROVE' },
    });
};
exports.approvePr = approvePr;

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
        // console.log(pr.title, 'pending verifications status');
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

const textMatchesJankIndex = textMatchesString('jank:');
const textMatchesShipit = textMatchesAnyString(shippedEmojis);
const textMatchesUpdate = textMatchesAnyString(updateMeEmojis);

const triggers = {
    shipped: 'SHIPIT',
    fixup: 'FIXUP',
    mobileJank: 'JANK',
};

const prsToTriggered = async (triggerReason, textFilter, pullReqs, filterByLabelName = false) => {
    const prs = (await getOpenPrs(pullReqs)).filter(pr => {
        // when requested, filter out any PRs that have a do not merge label.
        if (filterByLabelName && pr.labels.nodes.some(l => l.name.toLowerCase() === 'do not merge')) {
            return false;
        }
        return textFilter(pr.body) || pr.comments.nodes.map(c => c.body).some(textFilter);
    });

    // annotate the trigger reason.
    return prs.map(pr => ({ ...pr, triggerReason }));
};

// a pr is shipped if one of the emojis present in any of the comments.
// if you don't pass in pullReqs, they'll be queried from github.
const getShippedPrs = async pullReqs => prsToTriggered(triggers.shipped, textMatchesShipit, pullReqs, true);
const getUpdatePrs = async pullReqs => prsToTriggered(triggers.fixus, textMatchesUpdate, pullReqs);
const getJankIndexUpdatingPrs = async pullReqs => prsToTriggered(triggers.mobileJank, textMatchesJankIndex, pullReqs);
const getFixMasterPrs = async pullReqs => {
    return (await getOpenPrs(pullReqs)).filter(
        pr => pr.author.login === 'changpingc' && pr.title === 'fix master branch'
    );
};
exports.getFixMasterPrs = getFixMasterPrs;

// get prs which have a triggering emoji which aren't passing ci. We want to action on those in some way.
const getPrsToFixup = async pullReqs => {
    const pulls = await getOpenPrs(pullReqs);
    // we want to rebase if the last commit has any failing status.
    // pending statuses are ok because some statuses don't resolve until approvals happen.

    // dedupe by id in case a pr is both shipped and fixuped. We put shipped PRs first so that shipit action takes priority.
    const prs = _.uniqBy([...(await getShippedPrs(pulls)), ...(await getUpdatePrs(pulls))], pr => pr.id);
    const failingPrs = await prs.filterAsync(hasActionableFailingStatus);

    // we want to split out ones that are failing generically vs due to gitdiff.
    // so we annotate each pr with the reason it failed.
    const failureReasons = await failingPrs.mapAsync(async pr => {
        // shipped PRs we don't want to consider if they're failing git diff.
        if (pr.triggerReason === triggers.shipped) {
            return buildkite.failReasons.other;
        }
        // check if the PR is failing git diff in github.
        return await buildkite.isFailingGitDiff(pr);
    });
    failingPrs.forEach((pr, idx) => {
        pr.failureReason = failureReasons[idx];
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

const getBotEvents = pr => {
    const prefix = '<!-- simonbot';
    const stateLines = pr.body.split('\n').filter(line => line.startsWith(prefix));
    const events = stateLines.map(line => {
        const tokens = line
            .slice(prefix.length)
            .trim()
            .split(' ');
        return { type: tokens[0], timestamp: new Date(tokens[1] && Number(tokens[1])) };
    });
    return events;
};
const getNumberOfRebases = pr => getBotEvents(pr).filter(e => e.type === 'rebase').length;
const getJankHasNotBeenSet = pr => getBotEvents(pr).filter(e => e.type === 'janked').length === 0;
const getRebaseSkippedLogs = pr => getBotEvents(pr).filter(e => e.type === 'rebaseSkipped');

exports.getJankHasNotBeenSet = getJankHasNotBeenSet;
exports.getNumberOfRebases = getNumberOfRebases;

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

const logEvent = async (pr, text) => await appendToBody(pr, `<!-- simonbot ${text} ${Date.now()} -->`);

exports.logSetJank = async pr => {
    await logEvent(pr, 'janked');
};

exports.logRebase = async pr => {
    await logEvent(pr, 'rebase');
    const numRebases = getNumberOfRebases(pr);
    // if we're over the max number of rebases, then let's comment to indicate that.
    if (numRebases >= constants.MAX_REBASE_ATTEMPTS) {
        await addComment(pr, `🥵 max rebases hit (${constants.MAX_REBASE_ATTEMPTS})`);
    }
};

exports.logSkippingRebase = async pr => {
    // we comment if we're skipping. If there's a comment from equal or after
    // the time of the most recent commit, then don't comment.
    // that way, if we rebase or people force push, we'll comment again.
    const latestSkipRebase = getRebaseSkippedLogs(pr).last();
    const shouldComment = new Date(pullrequest.getLatestCommit(pr).authoredDate) > latestSkipRebase.timestamp;
    if (shouldComment) {
        await logEvent(pr, 'rebaseSkipped');
        await addComment(pr, `😴 master is broken. Sheepy will rebase once master is passing.`);
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

exports.getRateLimitInfo = async () => {
    try {
        const resp = await client.v3request({ uri: '/rate_limit' });
        return resp.body.resources;
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
