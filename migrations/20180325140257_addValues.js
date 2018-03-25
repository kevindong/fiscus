
exports.up = function(knex, Promise) {
  return knex.schema.table('portfolios', function(table) {
    table.text('values').nullable();
  });
};

exports.down = function(knex, Promise) {
  return knex.schema.table('portfolios', function(table) {
    table.dropColumn('values');
  });
};
