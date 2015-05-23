var dl = require('datalib'),
    lgnd = require('../scene/legend');

function parseLegends(model, spec, legends, group) {
  (spec || []).forEach(function(def, index) {
    legends[index] = legends[index] || lgnd(model);
    parseLegend(def, index, legends[index], group);
  });
}

function parseLegend(def, index, legend, group) {
  // legend scales
  legend.size  (def.size   ? group.scale(def.size)   : null);
  legend.shape (def.shape  ? group.scale(def.shape)  : null);
  legend.fill  (def.fill   ? group.scale(def.fill)   : null);
  legend.stroke(def.stroke ? group.scale(def.stroke) : null);

  // legend orientation
  if (def.orient) legend.orient(def.orient);

  // legend offset
  if (dl.isValid(def.offset)) legend.offset(def.offset);

  // legend title
  legend.title(def.title || null);

  // legend values
  legend.values(def.values || null);

  // legend label formatting
  legend.format(def.format !== undefined ? def.format : null);

  // style properties
  var p = def.properties;
  legend.titleProperties(p && p.title || {});
  legend.labelProperties(p && p.labels || {});
  legend.legendProperties(p && p.legend || {});
  legend.symbolProperties(p && p.symbols || {});
  legend.gradientProperties(p && p.gradient || {});
}

module.exports = parseLegends;