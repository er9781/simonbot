var github = require('../github/github');
var fixer = require('../prfixer/fixer');

const delaySeconds = 5;

const fireloop = env => {
    const startMs = Date.now();

    // do main thing
    const openPrs = github.getOpenPrs().then(prs => {
        github
            .getPrsToRebase(prs)
            .then(prs => {
                const sliced = prs; //.slice(0, 1)
                return fixer.handleAllPrs(env, sliced);
            })
            .catch(err => {
                console.log(err);
            })
            .finally(() => {
                github.mergePrs(prs).finally(() => {
                    // trigger next loop. wait at least some delay from last loop to let github get up to date.
                    const delay = Math.max(2000, delaySeconds * 1000 - (Date.now() - startMs));
                    setTimeout(() => fireloop(env), delay);
                });
            });
    });
};

exports.fireloop = fireloop;
