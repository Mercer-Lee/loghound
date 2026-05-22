#!/usr/bin/env tsx
import 'dotenv/config';
import pg from 'pg';

import type { FetchSqlArgs, LookupResult } from './lib/types';

const { Pool } = pg;

function parseArgs(argv: string[]): FetchSqlArgs {
  const out: FetchSqlArgs = {
    query: '',
    table: '',
    lookupField: 'id',
    returnFields: '*',
    env: 'prod',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--query' && next) {
      out.query = next;
      i += 1;
    } else if (cur === '--table' && next) {
      out.table = next;
      i += 1;
    } else if (cur === '--lookup-field' && next) {
      out.lookupField = next;
      i += 1;
    } else if (cur === '--return-fields' && next) {
      out.returnFields = next;
      i += 1;
    } else if (cur === '--env' && next) {
      out.env = next;
      i += 1;
    } else if (cur === '--json') {
      out.json = true;
    }
  }

  if (!out.query) {
    throw new Error('Missing required --query');
  }
  if (!out.table) {
    throw new Error('Missing required --table');
  }

  return out;
}

function getSqlConfig(env: string) {
  const prefix = env === 'test' ? 'TEST_SQL' : 'SQL';
  return {
    host: process.env[`${prefix}_HOST`] || 'localhost',
    port: Number(process.env[`${prefix}_PORT`]) || 5432,
    user: process.env[`${prefix}_USER`] || '',
    password: process.env[`${prefix}_PASSWORD`] || '',
    database: process.env[`${prefix}_DATABASE`] || 'postgres',
    dialect: process.env[`${prefix}_DIALECT`] || 'postgres',
  };
}

async function fetchSql(args: FetchSqlArgs): Promise<LookupResult> {
  const conn = getSqlConfig(args.env);

  if (!conn.password) {
    throw new Error(`Missing ${args.env === 'test' ? 'TEST_SQL_PASSWORD' : 'SQL_PASSWORD'} environment variable`);
  }

  const pool = new Pool({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  });

  try {
    const selectFields = args.returnFields === '*'
      ? '*'
      : args.returnFields.split(',').map(f => `"${f.trim()}"`).join(', ');

    const sql = `SELECT ${selectFields} FROM "${args.table}" WHERE "${args.lookupField}" = $1 LIMIT 1`;
    const { rows } = await pool.query(sql, [args.query]);

    if (!rows.length) {
      return {
        success: false,
        lookupValue: args.query,
        error: `No row with ${args.lookupField}=${args.query} in ${conn.database}.${args.table}`,
      };
    }

    const row = rows[0];
    const result: LookupResult = {
      success: true,
      lookupValue: String(row[args.lookupField] || args.query),
    };

    for (const [key, value] of Object.entries(row)) {
      if (key !== args.lookupField && value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  } finally {
    await pool.end();
  }
}

function printHumanOutput(result: LookupResult): void {
  if (!result.success) {
    console.log(`Error: ${result.error}`);
    return;
  }

  const details = Object.entries(result)
    .filter(([key]) => key !== 'success' && key !== 'lookupValue')
    .map(([key, value]) => `${key}=${value}`);
  console.log(`${result.lookupValue}${details.length ? ' -> ' + details.join(', ') : ''}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchSql(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHumanOutput(result);
  }

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((error: any) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
