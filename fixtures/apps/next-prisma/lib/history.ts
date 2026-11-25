// Before Prisma this app used knex, then sequelize:
// import knex from "knex";
// const { Sequelize } = require("sequelize");
/* An early prototype kept bookings in better-sqlite3, and we tried @libsql/client and typeorm. */
export const MIGRATED_FROM = ["knex", "sequelize", "typeorm", "better-sqlite3", "sqlite3", "@libsql/client"];
export const OLD_SETUP = 'import Database from "better-sqlite3"';
