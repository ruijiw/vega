var util = require('datalib/src/util'),
    ChangeSet = require('vega-dataflow/src/ChangeSet'),
    Tuple = require('vega-dataflow/src/Tuple'),
    Deps = require('vega-dataflow/src/Dependencies'),
    log = require('vega-logging'),
    Transform = require('./Transform'),
    Facetor = require('./Facetor');

function Aggregate(graph) {
  Transform.prototype.init.call(this, graph);

  Transform.addParameters(this, {
    groupby: {type: 'array<field>'},
    summarize: {
      type: 'custom', 
      set: function(summarize) {
        var signals = {},
            i, len, f, fields, name, ops;

        if (!util.isArray(fields = summarize)) { // Object syntax from util
          fields = [];
          for (name in summarize) {
            ops = util.array(summarize[name]);
            fields.push({field: name, ops: ops});
          }
        }

        function sg(x) { if (x.signal) signals[x.signal] = 1; }

        for (i=0, len=fields.length; i<len; ++i) {
          f = fields[i];
          if (f.field.signal) signals[f.field.signal] = 1;
          util.array(f.ops).forEach(sg);
          util.array(f.as).forEach(sg);
        }

        this._transform._fieldsDef = fields;
        this._transform._aggr = null;
        this._transform.dependency(Deps.SIGNALS, util.keys(signals));
        return this._transform;
      }
    }
  });

  this._fieldsDef = [];
  this._aggr = null;  // util.Aggregator

  this._type = TYPES.TUPLE; 
  this._acc = {groupby: util.true, value: util.true};
  this._cache = {}; // And cache them as aggregators expect original tuples.

  // Aggregator needs a full instantiation of the previous tuple.
  // Cache them to reduce creation costs.
  this._prev = {}; 

  return this.router(true).revises(true);
}

var prototype = (Aggregate.prototype = Object.create(Transform.prototype));
prototype.constructor = Aggregate;

var TYPES = Aggregate.TYPES = {
  VALUE: 1, 
  TUPLE: 2, 
  MULTI: 3
};

prototype.type = function(type) { 
  return (this._type = type, this); 
};

prototype.accessors = function(groupby, value) {
  var acc = this._acc;
  acc.groupby = util.$(groupby) || util.true;
  acc.value = util.$(value) || util.true;
};

function standardize(x) {
  var acc = this._acc;
  if (this._type === TYPES.TUPLE) {
    return x;
  } else if (this._type === TYPES.VALUE) {
    return acc.value(x);
  } else {
    return this._cache[x._id] || (this._cache[x._id] = {
      _id: x._id,
      groupby: acc.groupby(x),
      value: acc.value(x)
    });
  }
}

prototype.aggr = function() {
  if (this._aggr) return this._aggr;

  var graph = this._graph,
      groupby = this.param('groupby').field;

  var fields = this._fieldsDef.map(function(field) {
    var f = util.duplicate(field);
    if (field.get) f.get = field.get;

    f.name = f.field.signal ? graph.signalRef(f.field.signal) : f.field;
    f.ops  = f.ops.signal ? graph.signalRef(f.ops.signal) :
      util.array(f.ops).map(function(o) {
        return o.signal ? graph.signalRef(o.signal) : o;
      });

    return f;
  });

  if (!fields.length) fields = {'*':'values'};

  var aggr = this._aggr = new Facetor()
    .groupby(groupby)
    .stream(true)
    .summarize(fields);

  if (this._type !== TYPES.VALUE) aggr.key('_id');
  return aggr;
};

prototype._reset = function(input, output) {
  output.rem.push.apply(output.rem, this.aggr().result());
  this.aggr().clear();
  this._aggr = null;
};

function spoof_prev(x) {
  var prev = this._prev[x._id] || (this._prev[x._id] = Object.create(x));
  return util.extend(prev, x._prev);
}

prototype.transform = function(input, reset) {
  log.debug(input, ['aggregate']);

  var output = ChangeSet.create(input);
  if (reset) this._reset(input, output);

  var t = this,
      tpl = this._type === TYPES.TUPLE, // reduce calls to standardize
      aggr = this.aggr();

  input.add.forEach(function(x) {
    aggr._add(tpl ? x : standardize.call(t, x));
  });

  input.mod.forEach(function(x) {
    if (reset) {
      // Signal change triggered reflow
      aggr._add(tpl ? x : standardize.call(t, x));
    } else {
      var y = Tuple.has_prev(x) ? spoof_prev.call(t, x) : x;
      aggr._mod(tpl ? x : standardize.call(t, x), 
        tpl ? y : standardize.call(t, y));
    }
  });

  input.rem.forEach(function(x) {
    var y = Tuple.has_prev(x) ? spoof_prev.call(t, x) : x;
    aggr._rem(tpl ? y : standardize.call(t, y));
    t._cache[x._id] = t._prev[x._id] = null;
  });

  return aggr.changes(input, output);
};

var VALID_OPS = Aggregate.VALID_OPS = [
  "values", "count", "valid", "missing", "distinct", 
  "sum", "mean", "average", "variance", "variancep", "stdev", 
  "stdevp", "median", "q1", "q3", "modeskew", "min", "max", 
  "argmin", "argmax"
];

module.exports = Aggregate;

Aggregate.schema = {
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "Aggregate transform",
  "description": "Compute summary aggregate statistics",
  "type": "object",
  "properties": {
    "type": {"enum": ["aggregate"]},
    "groupby": {
      "type": "array",
      "items": {"oneOf": [{"type": "string"}, {"$ref": "#/refs/signal"}]},
      "description": "A list of fields to split the data into groups."
    },
    "summarize": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "description": "An array of aggregate functions.",
            "items": {"oneOf": [{"enum": VALID_OPS}, {"$ref": "#/refs/signal"}]}
          }
        },
        {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "field": {
                "description": "The name of the field to aggregate.",
                "oneOf": [{"type": "string"}, {"$ref": "#/refs/signal"}]
              },
              "ops": {
                "type": "array",
                "description": "An array of aggregate functions.",
                "items": {"oneOf": [{"enum": VALID_OPS}, {"$ref": "#/refs/signal"}]}
              },
              "as": {
                "type": "array",
                "description": "An optional array of names to use for the output fields.",
                "items": {"oneOf": [{"type": "string"}, {"$ref": "#/refs/signal"}]}
              }
            },
            "additionalProperties": false,
            "required": ["field", "ops"]
          }
        }
      ]
    }
  },
  "additionalProperties": false,
  "required": ["type"]
};
