var dl = require('datalib'),
    expression = require('../expression');

var expr = (function() {
  var parse = expression.parse;
  var codegen = expression.code({
    idWhiteList: ['d', 'e', 'i', 'p', 'sg']
  });

  return function(expr) {    
    var value = codegen(parse(expr));
    /* jshint evil: true */
    value.fn = new Function('d', 'e', 'i', 'p', 'sg',
      '"use strict"; return (' + value.fn + ');');
    return value;
  };
})();

/* jshint evil: true */
expr.eval = function(graph, fn, d, e, i, p, sg) {
  sg = graph.signalValues(dl.array(sg));
  return fn.call(null, d, e, i, p, sg);
};

module.exports = expr;