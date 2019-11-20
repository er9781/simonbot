const got = require("got");

const jankRe = /jank:[0-9]+/;

const bound = (min, max) => n => Math.max(min, Math.min(max, n));
const boundJank = bound(0, 100);
const getJankIndexUpdateFromString = str => {
  const s = str.match(jankRe)[1];
  if (!s) return undefined;
  return boundJank(Number(s));
}

const postJankIndex = index => got.post(`https://shaneschulte.com/mob_jank_gauge/set_jank.php`, {
  body: `jank=${index * 10}`,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
});

const handlePr = async pr => {
  const text = pr.body;
  const jankIndex = getJankIndexUpdateFromString(text);
  if (jank === undefined) return;
  await postJankIndex(jankIndex);
}

exports.postJankIndexFromPr = postJankIndexFromPr;

