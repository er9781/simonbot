var github = require('../github/github');
var fixer = require('../prfixer/fixer');

const delaySeconds = 5;

const fireloop = () => {
    const startMs = Date.now();

    // do main thing
    github
        .getPrsToRebase()
        .then(prs => {
            const sliced = prs; //.slice(0, 1)
            return Promise.all(sliced.map(fixer.handlePr));
        })
        .catch(err => {
            console.log(err);
        })
        .finally(() => {
            // trigger next loop. wait at least some delay from last loop.
            const delay = Math.max(0, delaySeconds * 1000 - (Date.now() - startMs));
            setTimeout(fireloop, delay);
        });

    // check end time.

    // set timeout for 5s poll for next event. (use min) for the fire loop.
};

exports.fireloop = fireloop;
