// I'm a horrible human and want these things. #sorrynotsorry

Array.prototype.first = function() {
    return this[0];
};
Array.prototype.last = function() {
    return this[this.length - 1];
};

Array.prototype.filterAsync = function(f) {
    return (
        Promise.all(this.map((el, idx, arr) => f(el, idx, arr)))
            // return a promise which resolves to a filtered array.
            .then(results => {
                return this.filter((_, idx) => {
                    return results[idx];
                });
            })
    );
};

Array.prototype.removeAsync = function(f) {
    return (
        Promise.all(this.map((el, idx, arr) => f(el, idx, arr)))
            // return a promise which resolves to a filtered array.
            .then(results => {
                return this.filter((_, idx) => {
                    return !results[idx];
                });
            })
    );
};
