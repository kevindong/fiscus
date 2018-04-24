exports.up = function(knex, Promise) {
  return Promise.all([
    knex.schema.createTable('watchlist', function(table) {
      table.increments().primary().notNullable();
      table.integer('userId').references('users.id').notNullable();
      table.string('ticker', 8).notNullable();
      table.date('dateAdded').notNullable();
      table.decimal('initialPrice', 10, 2).notNullable();
      table.timestamps();
    })
  ]);
};

exports.down = function(knex, Promise) {
  return Promise.all([
    knex.schema.dropTable('watchlist')
  ]);
};
