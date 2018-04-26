exports.up = function (knex, Promise) {
  return Promise.all([
    knex.schema.table('portfolios', function (table) {
      table.json('unfilledSplits');
    })
  ]);
};

exports.down = function (knex, Promise) {
  return Promise.all([
    knex.schema.table('portfolios', function (table) {
      table.dropColumn('unfilledSplits');
    })
  ])
};
