var ChangeSet = require('vega-dataflow/src/ChangeSet'),
    Tuple = require('vega-dataflow/src/Tuple'),
    log = require('vega-logging'),
    Transform = require('./Transform');

function Fold(graph) {
  Transform.prototype.init.call(this, graph);
  Transform.addParameters(this, {
    fields: {type: 'array<field>'} 
  });

  this._output = {key: 'key', value: 'value'};
  this._cache = {};

  return this.router(true).revises(true);
}

var prototype = (Fold.prototype = Object.create(Transform.prototype));
prototype.constructor = Fold;

function rst(input, output) { 
  for (var id in this._cache) {
    output.rem.push.apply(output.rem, this._cache[id]);
  }
  this._cache = {};
}

function get_tuple(x, i, len) {
  var list = this._cache[x._id] || (this._cache[x._id] = Array(len));
  return list[i] || (list[i] = Tuple.derive(x, x._prev));
}

function fn(data, on, out) {
  var i, j, n, m, d, t;
  for (i=0, n=data.length; i<n; ++i) {
    d = data[i];
    for (j=0, m=on.field.length; j<m; ++j) {
      t = get_tuple.call(this, d, j, m);  
      Tuple.set(t, this._output.key, on.field[j]);
      Tuple.set(t, this._output.value, on.accessor[j](d));
      out.push(t);
    }      
  }
}

prototype.transform = function(input, reset) {
  log.debug(input, ['folding']);

  var fold = this,
      on = this.param('fields'),
      output = ChangeSet.create(input);

  if (reset) rst.call(this, input, output);

  fn.call(this, input.add, on, output.add);
  fn.call(this, input.mod, on, reset ? output.add : output.mod);
  input.rem.forEach(function(x) {
    output.rem.push.apply(output.rem, fold._cache[x._id]);
    fold._cache[x._id] = null;
  });

  // If we're only propagating values, don't mark key/value as updated.
  if (input.add.length || input.rem.length || 
      on.field.some(function(f) { return !!input.fields[f]; })) {
    output.fields[this._output.key] = 1;
    output.fields[this._output.value] = 1;
  }
  return output;
};

module.exports = Fold;

Fold.schema = {
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "Fold transform",
  "description": "Collapse (\"fold\") one or more data properties into two properties.",
  "type": "object",
  "properties": {
    "type": {"enum": ["fold"]},
    "fields": {
      "oneOf": [
        {
          "type": "array",
          "description": "An array of field references indicating the data properties to fold.",
          "items": {"oneOf": [{"type": "string"}, {"$ref": "#/refs/signal"}]},
          "minItems": 1,
          "uniqueItems": true
        },
        {"$ref": "#/refs/signal"}
      ]
    },
    "output": {
      "type": "object",
      "description": "Rename the output data fields",
      "properties": {
        "key": {"type": "string", "default": "key"},
        "value": {"type": "string", "default": "value"}
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "required": ["type", "fields"]
};
