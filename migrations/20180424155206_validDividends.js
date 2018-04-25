exports.up = function (knex, Promise) {
  return Promise.all([
    knex.schema.table('portfolios', function (table) {
      table.json('unfilledDivs');
    })
  ]);
};

exports.down = function (knex, Promise) {
  return Promise.all([
    knex.schema.table('portfolios', function (table) {
      table.dropColumn('unfilledDivs');
    })
  ])
};
