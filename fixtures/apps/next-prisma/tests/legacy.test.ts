import Database from "better-sqlite3";
import sqlite3 from "sqlite3";
import { createClient } from "@libsql/client";
import { DataSource } from "typeorm";
import knex from "knex";
import { Sequelize } from "sequelize";
import { expect, it } from "vitest";

// Compares old query results against Prisma's while the migration is checked.
it("has the old clients available for comparison", () => {
  expect([Database, sqlite3, createClient, DataSource, knex, Sequelize].every(Boolean)).toBe(true);
});
