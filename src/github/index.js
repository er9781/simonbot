var client = require('./client');
var config = require('../config');
var c = require('../common');

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
                        body
                        title
                        mergeable
                        # mergeStateStatus
                        # canBeRebased
                        # base branch so that rebasing can be done properly onto that.
                        baseRef {
                            name
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

    // check suite query as needed.
    // checkSuites(last: 4) {
    //     nodes {
    //         conclusion
    //         status
    //         checkRuns(last: 50) {
    //             nodes {
    //                 conclusion
    //                 name
    //                 title
    //                 status
    //             }
    //         }
    //     }
    // }

    const resp = await client.query(query);
    return resp.body.data.viewer.pullRequests.nodes;
};

// prs that are open that are in the repo the app is configured for.
// if you don't pass in pullReqs, they'll be queried from github.
const getOpenPrs = async pullReqs => {
    return (await getPrs(pullReqs)).filter(pr => config.gitrepourl.includes(pr.headRepository.url));
};

const getRefStatuses = async sha => {
    return await client.v3request({
        uri: `/repos/${config.secrets.repoowner}/${config.secrets.repo}/commits/${sha}/statuses`,
    });
};

const hasFailingStatus = async pr => {
    const isFailed = t => t === 'failure';
    const lastCommit = pr.commits.nodes.last().commit;
    const statuses = (await getRefStatuses(lastCommit.oid)).body;
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
    const prs = [...(await getShippedPrs(pullReqs)), ...(await getUpdatePrs(pullReqs))];
    // we want to rebase if the last commit has any failing status.
    // pending statuses are ok because some statuses don't resolve until approvals happen.
    return await prs.filterAsync(hasFailingStatus);
};

exports.getOpenPrs = getOpenPrs;
exports.getShippedPrs = getShippedPrs;
exports.getUpdatePrs = getUpdatePrs;
exports.getPrsToRebase = getPrsToRebase;

exports.getRefStatuses = getRefStatuses;
