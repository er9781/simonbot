exports.getBaseBranch = pr => pr.baseRef.name;
exports.getBranch = pr => pr.headRef.name;

// returns a list of pr commits in reverse chronological order
exports.getCommits = pr => {
    const commits = [...pr.commits.nodes.map(n => n.commit)];
    commits.reverse();
    return commits;
};
