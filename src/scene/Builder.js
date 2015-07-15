var util = require('datalib/src/util'),
    Item = require('vega-scenegraph/src/util/Item'),
    Tuple = require('vega-dataflow/src/Tuple'),
    ChangeSet = require('vega-dataflow/src/ChangeSet'),
    Node = require('vega-dataflow/src/Node'), // jshint ignore:line
    Deps = require('vega-dataflow/src/Dependencies'),
    Sentinel = require('vega-dataflow/src/Sentinel'),
    log = require('vega-logging'),
    Encoder  = require('./Encoder'),
    Bounder  = require('./Bounder'),
    parseData = require('../parse/data');

function Builder() {    
  return arguments.length ? this.init.apply(this, arguments) : this;
}

var Status = Builder.STATUS = {
  ENTER: "enter",
  UPDATE: "update",
  EXIT: "exit"
};

var proto = (Builder.prototype = new Node());

proto.init = function(graph, def, mark, parent, parent_id, inheritFrom) {
  Node.prototype.init.call(this, graph)
    .router(true)
    .collector(true);

  this._def   = def;
  this._mark  = mark;
  this._from  = (def.from ? def.from.data : null) || inheritFrom;
  this._ds    = util.isString(this._from) ? graph.data(this._from) : null;
  this._map   = {};

  this._revises = false;  // Should scenegraph items track _prev?

  mark.def = def;
  mark.marktype = def.type;
  mark.interactive = (def.interactive !== false);
  mark.items = [];
  if (util.isValid(def.name)) mark.name = def.name;

  this._parent = parent;
  this._parent_id = parent_id;

  if (def.from && (def.from.mark || def.from.transform || def.from.modify)) {
    inlineDs.call(this);
  }

  // Non-group mark builders are super nodes. Encoder and Bounder remain 
  // separate operators but are embedded and called by Builder.evaluate.
  this._isSuper = (this._def.type !== "group"); 
  this._encoder = new Encoder(this._graph, this._mark);
  this._bounder = new Bounder(this._graph, this._mark);
  this._output  = null; // Output changeset for reactive geom as Bounder reflows

  if (this._ds) { this._encoder.dependency(Deps.DATA, this._from); }

  // Since Builders are super nodes, copy over encoder dependencies
  // (bounder has no registered dependencies).
  this.dependency(Deps.DATA, this._encoder.dependency(Deps.DATA));
  this.dependency(Deps.SCALES, this._encoder.dependency(Deps.SCALES));
  this.dependency(Deps.SIGNALS, this._encoder.dependency(Deps.SIGNALS));

  return this;
};

proto.revises = function(p) {
  if (!arguments.length) return this._revises;

  // If we've not needed prev in the past, but a new inline ds needs it now
  // ensure existing items have prev set.
  if (!this._revises && p) {
    this._items.forEach(function(d) { if (d._prev === undefined) d._prev = Sentinel; });
  }

  this._revises = this._revises || p;
  return this;
};

// Reactive geometry and mark-level transformations are handled here 
// because they need their group's data-joined context. 
function inlineDs() {
  var from = this._def.from,
      geom = from.mark,
      src, name, spec, sibling, output, input;

  if (geom) {
    name = ["vg", this._parent_id, geom].join("_");
    spec = {
      name: name,
      transform: from.transform, 
      modify: from.modify
    };
  } else {
    src = this._graph.data(this._from);
    name = ["vg", this._from, this._def.type, src.listeners(true).length].join("_");
    spec = {
      name: name,
      source: this._from,
      transform: from.transform,
      modify: from.modify
    };
  }

  this._from = name;
  this._ds = parseData.datasource(this._graph, spec);
  var revises = this._ds.revises(), node;

  if (geom) {
    sibling = this.sibling(geom).revises(revises);

    // Bounder reflows, so we need an intermediary node to propagate
    // the output constructed by the Builder.
    node = new Node(this._graph).addListener(this._ds.listener());
    node.evaluate = function(input) { return sibling._output; };

    if (sibling._isSuper) {
      sibling.addListener(node);
    } else {
      sibling._bounder.addListener(node);
    }
  } else {
    // At this point, we have a new datasource but it is empty as
    // the propagation cycle has already crossed the datasources. 
    // So, we repulse just this datasource. This should be safe
    // as the ds isn't connected to the scenegraph yet.
    
    output = this._ds.source().revises(revises).last();
    input  = ChangeSet.create(output);

    input.add = output.add;
    input.mod = output.mod;
    input.rem = output.rem;
    input.stamp = null;
    this._graph.propagate(input, this._ds.listener(), output.stamp);
  }
}

proto.pipeline = function() {
  return [this];
};

proto.connect = function() {
  var builder = this;

  this._graph.connect(this.pipeline());
  this._encoder._scales.forEach(function(s) {
    if (!(s = builder._parent.scale(s))) return;
    s.addListener(builder);
  });

  if (this._parent) {
    if (this._isSuper) this.addListener(this._parent._collector);
    else this._bounder.addListener(this._parent._collector);
  }

  return this;
};

proto.disconnect = function() {
  var builder = this;
  if (!this._listeners.length) return this;

  Node.prototype.disconnect.call(this);
  this._graph.disconnect(this.pipeline());
  this._encoder._scales.forEach(function(s) {
    if (!(s = builder._parent.scale(s))) return;
    s.removeListener(builder);
  });
  return this;
};

proto.sibling = function(name) {
  return this._parent.child(name, this._parent_id);
};

proto.evaluate = function(input) {
  log.debug(input, ["building", (this._from || this._def.from), this._def.type]);

  var output, fullUpdate, fcs, data, name;

  if (this._ds) {
    output = ChangeSet.create(input);

    // We need to determine if any encoder dependencies have been updated.
    // However, the encoder's data source will likely be updated, and shouldn't
    // trigger all items to mod.
    data = output.data[(name=this._ds.name())];
    delete output.data[name];
    fullUpdate = this._encoder.reevaluate(output);
    output.data[name] = data;

    // If a scale or signal in the update propset has been updated, 
    // send forward all items for reencoding if we do an early return.
    if (fullUpdate) output.mod = this._mark.items.slice();

    fcs = this._ds.last();
    if (!fcs) throw Error('Builder evaluated before backing DataSource');
    if (fcs.stamp > this._stamp) {
      output = joinDatasource.call(this, fcs, this._ds.values(), fullUpdate);
    }
  } else {
    data = util.isFunction(this._def.from) ? this._def.from() : [Sentinel];
    output = joinValues.call(this, input, data);
  }

  // Stash output before Bounder for downstream reactive geometry.
  this._output = output = this._graph.evaluate(output, this._encoder);

  // Supernodes calculate bounds too, but only on items marked dirty.
  if (this._isSuper) {
    output.mod = output.mod.filter(function(x) { return x._dirty; });
    output = this._graph.evaluate(output, this._bounder);
  }

  return output;
};

function newItem() {
  var prev = this._revises ? null : undefined,
      item = Tuple.ingest(new Item(this._mark), prev);

  // For the root node's item
  if (this._def.width)  Tuple.set(item, "width",  this._def.width);
  if (this._def.height) Tuple.set(item, "height", this._def.height);
  return item;
}

function join(data, keyf, next, output, prev, mod) {
  var i, key, len, item, datum, enter;

  for (i=0, len=data.length; i<len; ++i) {
    datum = data[i];
    item  = keyf ? this._map[key = keyf(datum)] : prev[i];
    enter = item ? false : (item = newItem.call(this), true);
    item.status = enter ? Status.ENTER : Status.UPDATE;
    item.datum = datum;
    Tuple.set(item, "key", key);
    this._map[key] = item;
    next.push(item);
    if (enter) {
      output.add.push(item);
    } else if (!mod || (mod && mod[datum._id])) {
      output.mod.push(item);
    }
  }
}

function joinDatasource(input, data, fullUpdate) {
  var output = ChangeSet.create(input),
      keyf = keyFunction(this._def.key || "_id"),
      mod = input.mod,
      rem = input.rem,
      next = [],
      i, key, len, item;

  // Build rems first, and put them at the head of the next items
  // Then build the rest of the data values (which won't contain rem).
  // This will preserve the sort order without needing anything extra.

  for (i=0, len=rem.length; i<len; ++i) {
    item = this._map[key = keyf(rem[i])];
    item.status = Status.EXIT;
    item._dirty = true;
    input.dirty.push(item);
    next.push(item);
    output.rem.push(item);
    this._map[key] = null;
  }

  join.call(this, data, keyf, next, output, null, Tuple.idMap(fullUpdate ? data : mod));

  return (this._mark.items = next, output);
}

function joinValues(input, data) {
  var output = ChangeSet.create(input),
      keyf = keyFunction(this._def.key),
      prev = this._mark.items || [],
      next = [],
      i, len, item;

  for (i=0, len=prev.length; i<len; ++i) {
    item = prev[i];
    item.status = Status.EXIT;
    if (keyf) this._map[item.key] = item;
  }

  join.call(this, data, keyf, next, output, prev, Tuple.idMap(data));

  for (i=0, len=prev.length; i<len; ++i) {
    item = prev[i];
    if (item.status === Status.EXIT) {
      Tuple.set(item, "key", keyf ? item.key : this._items.length);
      item._dirty = true;
      input.dirty.push(item);
      next.splice(0, 0, item);  // Keep item around for "exit" transition.
      output.rem.push(item);
    }
  }

  return (this._mark.items = next, output);
}

function keyFunction(key) {
  if (key == null) return null;
  var f = util.array(key).map(util.accessor);
  return function(d) {
    for (var s="", i=0, n=f.length; i<n; ++i) {
      if (i>0) s += "|";
      s += String(f[i](d));
    }
    return s;
  };
}

module.exports = Builder;
