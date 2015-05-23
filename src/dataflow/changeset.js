var C = require('../util/constants');
var REEVAL = [C.DATA, C.FIELDS, C.SCALES, C.SIGNALS];

function copy(a, b) {
  b.stamp = a ? a.stamp : 0;
  b.sort  = a ? a.sort  : null;
  b.facet = a ? a.facet : null;
  b.trans = a ? a.trans : null;
  b.request = a ? a.request : null;
  REEVAL.forEach(function(d) { b[d] = a ? a[d] : {}; });
}

function create(cs, reflow) {
  var out = {};
  copy(cs, out);

  out.add = [];
  out.mod = [];
  out.rem = [];

  out.reflow = reflow;

  return out;
}

function resetPrev(x) {
  x._prev = (x._prev === undefined) ? undefined : C.SENTINEL;
}

function finalize(cs) {
  var i, len;
  for (i=0, len=cs.add.length; i<len; ++i) resetPrev(cs.add[i]);
  for (i=0, len=cs.mod.length; i<len; ++i) resetPrev(cs.mod[i]);
}

module.exports = {
  create: create,
  copy: copy,
  finalize: finalize,
};