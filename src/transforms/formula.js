define(function(require, exports, module) {
  var vg = require('vega'), 
      tuple = require('../core/tuple'), 
      expr = require('../parse/expr');

  return function formula(model) {
    var field = null, fn = vg.identity;

    function f(x, stamp) { 
      var val = expr.eval(model, fn, x, null, null, node._deps.signals);
      tuple.set(x, field, val, stamp); 
    }

    var node = new model.Node(function(input) {  
      global.debug(input, ["formulating"]);  

      input.add.forEach(function(x) { f(x, input.stamp) });;
      input.mod.forEach(function(x) { f(x, input.stamp) });
      input.fields[field] = 1;
      return input;
    });   

    node.field = function(name) {
      field = name;
      return node;
    };

    node.expr = function(s) { 
      if(vg.isFunction(s)) f = s;
      else {
        s = expr(model, s);
        fn = s.fn;
        node._deps.signals = s.signals;
        node._deps.fields  = s.fields;
      }
      return node;
    };

    return node;
  };
});