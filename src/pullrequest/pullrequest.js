var _ = require('lodash');

exports.getBaseBranch = pr => pr.baseRef.name;
exports.getBranch = pr => pr.headRef.name;

const getCommits = pr => {
    const commits = [...pr.commits.nodes.map(n => n.commit)];
    commits.reverse();
    return commits;
};

// returns a list of pr commits in reverse chronological order
exports.getCommits = getCommits;

exports.getLatestCommit = pr => {
    return _.orderBy(getCommits(pr), ['authoredDate'], ['desc']).first();
};
