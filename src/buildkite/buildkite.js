var buildkite = require('./client');
var pullrequest = require('../pullrequest/pullrequest');
var _ = require('lodash');
var http = require('../http/http');

// TODO maybe need to update for mobile tests as well?
const getLatestMasterBuild = async () => {
    try {
        const resp = await buildkite.request({
            uri: '/organizations/samsara/pipelines/backend-test/builds',
            // filter down to passed or failed commits.
            query: { branch: 'master', ['state[]']: ['passed', 'failed'] },
            // for testing when failed. Filter to failed only. Don't leave in prod.
            // query: { branch: 'master', ['state[]']: ['failed'] },
        });
        const latestBuild = _.orderBy(resp.body, ['created_at'], ['desc']).first();
        return latestBuild;
    } catch (err) {
        console.log('failed to get latest status on master', err);
        // TODO what to do here? exit? Always rebase? Return a fake passing state so that other things
        // go ahead? seems reasonable.
    }
};
exports.getLatestMasterBuild = getLatestMasterBuild;

const getDiffPatch = async pr => {
    if (pr.cachedPatch === undefined) {
        try {
            // we want builds only on the latest commit. Others are now void.
            const recentCommit = pullrequest.getCommits(pr).first();
            const { body } = await buildkite.request({
                uri: '/builds',
                query: { branch: pullrequest.getBranch(pr), commit: recentCommit.oid },
            });
            const backendTest = body.filter(build => build.pipeline.name.includes('backend-test')).first();

            const artifactUrl = _.minBy(
                backendTest.jobs.filter(job => job.name && job.name.includes('backend verifications')),
                job => job.name.length
            ).artifacts_url;

            const artifacts = (await buildkite.request({ url: artifactUrl })).body;
            const patchUrls = artifacts.filter(a => a.path.includes('.patch'));
            if (patchUrls.length > 0) {
                const downloadUrl = (await buildkite.request({ url: patchUrls.first().download_url })).body.url;
                const patch = (await http.request({ url: downloadUrl, method: 'GET' })).body;

                // cache the patch on the pr object. yay mutability.
                pr.cachedPatch = patch;
            }
        } catch (err) {
            // on any error, we'll just skip this one happily?
            console.log(err);
        }
    }

    return pr.cachedPatch;
};

exports.getDiffPatch = getDiffPatch;

const failReasons = {
    failingGitDiff: 'failingGitDiff',
    other: 'other',
};
exports.failReasons = failReasons;

// returns "failingGitDiff" if failing git diff, "other" for other failing statuses.
exports.isFailingGitDiff = async pr => {
    const patch = await getDiffPatch(pr);
    return patch ? failReasons.failingGitDiff : failReasons.other;
};

const requiredScopes = ['read_artifacts', 'read_builds', 'read_user'];
exports.requiredScopes = requiredScopes;

exports.checkAuth = async () => {
    const { body } = await buildkite.request({ uri: '/access-token' });
    // we have a set of scopes we expect to have access to.
    return body.scopes && requiredScopes.every(scope => body.scopes.includes(scope));
};
