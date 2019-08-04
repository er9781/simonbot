var client = require('./client');
var config = require('../config');
var c = require('../common');
var _ = require('lodash');

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
    const mutation = `
        mutation {
            mergePullRequest(input: {
                pullRequestId: ${pr.id}
            }) {
                pullRequest {
                    title
                    merged
                    closed
                }
            }
        }
    `;

    return await client.mutate(mutation);
};

// lol github doesn't like it if you just request the world.
// they have some checks. 100 comments max which is what we're actually
// worried abotu blowing. PRs 40 would probably be sufficient but whatever.
// if you're active in non-samsara repositories, then this might fail for you. :shrug:
const maxNodes = 100;

// if pullReqs is passed in, this is the identity function.
// useful in case they're being passed around.
const getPrs = async pullReqs => {
    if (pullReqs) {
        return pullReqs;
    }

    // query for open PRs by the viewer (access token based)
    const query = `
        query { 
            viewer { 
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
                        # uh, don't have more than 100 commits? (github has max 250 on this lmao)
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

    const resp = await client.query(query);
    return resp.body.data.viewer.pullRequests.nodes;
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

const hasFailingStatus = async pr => {
    const isFailed = t => t === 'failure';
    // we actually want the last commit with statuses. sometimes the last commit won't trigger ci.
    // why? deps detection? I'm not actually sure.
    let statuses = null;
    const commits = [...pr.commits.nodes.map(n => n.commit)];
    commits.reverse();
    for (let commit of commits) {
        const list = (await getRefStatuses(commit.oid)).body;
        if (c.notEmpty(list)) {
            statuses = list;
            break;
        }
    }
    return statuses.map(s => s.state).some(isFailed);
};

const shippedEmojis = [':shipit:', ':sheep:'];
const updateMeEmojis = [':fire_engine:', ':man_health_worker:'];

const textTriggersEmojiSet = emojiSet => text => emojiSet.some(e => text.includes(e));

const textTriggersShippit = textTriggersEmojiSet(shippedEmojis);
const textTriggersUpdate = textTriggersEmojiSet(updateMeEmojis);

const prsToTriggered = async (textFilter, pullReqs) => {
    const prs = (await getOpenPrs(pullReqs)).filter(pr => {
        return textFilter(pr.body) || pr.comments.nodes.map(c => c.body).some(textFilter);
    });
    return prs;
};

// a pr is shipped if one of the emojis present in any of the comments.
// if you don't pass in pullReqs, they'll be queried from github.
const getShippedPrs = async pullReqs => prsToTriggered(textTriggersShippit, pullReqs);
const getUpdatePrs = async pullReqs => prsToTriggered(textTriggersUpdate, pullReqs);

// get prs which have a triggering emoji which aren't passing ci. We want to rebase those.
const getPrsToRebase = async pullReqs => {
    const pulls = pullReqs || (await getOpenPrs());
    const prs = [...(await getShippedPrs(pulls)), ...(await getUpdatePrs(pulls))];
    // we want to rebase if the last commit has any failing status.
    // pending statuses are ok because some statuses don't resolve until approvals happen.
    return await _.orderBy(prs, 'updatedAt', 'desc').filterAsync(hasFailingStatus);
};

const getPrsToMerge = async pullReqs => {
    return await (await getShippedPrs(pullReqs)).removeAsync(hasFailingStatus);
};

const mergePrs = async pullReqs => {
    return await Promise.all(
        (await getPrsToMerge(pullReqs)).map(async pr => {
            try {
                mergePullRequest(pr);
            } catch (err) {
                // ignore errors in the merge to move on to the next one. Will pick up in next main loop
            }
        })
    );
};

exports.getOpenPrs = getOpenPrs;
exports.getShippedPrs = getShippedPrs;
exports.getUpdatePrs = getUpdatePrs;
exports.getPrsToRebase = getPrsToRebase;
exports.mergePrs = mergePrs;
