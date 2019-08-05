var github = require('../github/github');
var fixer = require('../prfixer/fixer');
var buildkite = require('../buildkite/client');

const delaySeconds = 5;

const mainActions = async env => {
    // we get the open prs up front so that each call below won't need to do it.
    const openPrs = await github.getOpenPrs();

    const prsToRebase = await github.getPrsToRebase(openPrs);
    console.log('rebase prs', prsToRebase.map(pr => pr.title));
    await fixer.handleAllPrsToRebase(env, prsToRebase);

    await github.mergePrs(openPrs);
};

const fireloop = env => {
    // buildkite.request({ uri: '/builds' }).then(resp => {
    //     console.log(resp.body.first().jobs);
    // });
    // return;
    const startMs = Date.now();

    // do main thing
    mainActions()
        .catch(err => {
            console.log(err);
            // TODO actual tracking?
        })
        .finally(() => {
            // trigger next loop. wait at least some delay from last loop to let github get up to date.
            const delay = Math.max(2000, delaySeconds * 1000 - (Date.now() - startMs));
            setTimeout(() => fireloop(env), delay);
        });
};

exports.fireloop = fireloop;
