var github = require('../github/github');
var fixer = require('../prfixer/fixer');

const delaySeconds = 5;

const fireloop = env => {
    const startMs = Date.now();

    // do main thing
    github
        .getPrsToRebase()
        .then(prs => {
            const sliced = prs; //.slice(0, 1)
            // handle all in one function. This needs to be synchronous in each.
            return fixer.handleAllPrs(env, sliced);
        })
        .catch(err => {
            console.log(err);
        })
        .finally(() => {
            // trigger next loop. wait at least some delay from last loop.
            const delay = Math.max(0, delaySeconds * 1000 - (Date.now() - startMs));
            setTimeout(() => fireloop(env), delay);
        });
};

exports.fireloop = fireloop;
