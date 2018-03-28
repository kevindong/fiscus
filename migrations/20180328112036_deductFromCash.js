exports.up = function (knex, Promise) {
  return Promise.all([
    knex.schema.table('transactions', function (table) {
      table.boolean('deductFromCash').notNullable().defaultTo(false);
    })
  ]);
};

exports.down = function (knex, Promise) {
  return Promise.all([
    knex.schema.table('transactions', function (table) {
      table.dropColumn('deductFromCash');
    })
  ])
};