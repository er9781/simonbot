var github = require('../github');
// TODO poll for PRs. And do something on each. Make event loop for this

// poll every 5s, or continuous depending on when last started.

const fireloop = () => {
    // log start time,

    // do main thing
    github
        .getPrsToRebase()
        .then(prs => {
            prs.forEach(pr => {
                console.log(pr.title);
            });
        })
        .catch(err => {
            console.log(err);
        });

    // github
    //     .getRefStatuses('c8e37e3b6ef810c8750798c83dafded352cbcb48')
    //     .then(data => console.log(data))
    //     .catch(err => console.log(err));

    // check end time.

    // set timeout for 5s poll for next event. (use min) for the fire loop.
};

exports.fireloop = fireloop;
