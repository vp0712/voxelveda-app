'use strict';

const australianCrDr = require('./australianCrDr');
const international = require('./international');
const generic = require('./generic');

const adapters = [australianCrDr, international, generic];

function selectAdapter(context) {
  return adapters
    .map((adapter) => ({ adapter, score: Number(adapter.match(context) || 0) }))
    .sort((left, right) => right.score - left.score)[0];
}

module.exports = { adapters, selectAdapter };
