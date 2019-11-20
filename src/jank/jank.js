const got = require('got');

const jankRe = /jank:([+\-]?)([0-9]+)/;

const bound = (min, max) => n => Math.max(min, Math.min(max, n));
const boundJank = bound(0, 100);

const modes = {
    '+': 'add',
    '-': 'subtract',
};

const modeString = mode => {
    if (!mode) return '';
    return `&mode=${modes[mode]}`;
};
const getJankBodyUpdateFromString = str => {
    const [_, mode, s] = str.match(jankRe) || [];
    if (!s) return undefined;
    return `jank=${boundJank(Number(s))}${modeString(mode)}`;
};

const postJankIndex = body =>
    got.post(`https://shaneschulte.com/mob_jank_gauge/set_jank.php`, {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

const postJankIndexFromPr = async pr => {
    const text = pr.body;
    const jankBody = getJankBodyUpdateFromString(text);
    if (jankBody === undefined) return;
    try {
        await Promise.all([postJankIndex(jankBody), github.logSetJank(pr)]);
    } catch (e) {
        console.log('ripperoni lololololol fix me fix me');
    }
};

exports.postJankIndexFromPr = postJankIndexFromPr;
