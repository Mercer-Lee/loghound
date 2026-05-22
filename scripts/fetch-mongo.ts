#!/usr/bin/env tsx
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

import type { FetchMongoArgs, LookupResult } from './lib/types';

function parseArgs(argv: string[]): FetchMongoArgs {
  const out: FetchMongoArgs = {
    query: '',
    collection: '',
    lookupField: '_id',
    json: false,
    env: 'prod',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--query' && next) {
      out.query = next;
      i += 1;
    } else if (cur === '--collection' && next) {
      out.collection = next;
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
  if (!out.collection) {
    throw new Error('Missing required --collection');
  }

  return out;
}

function getMongoConfig(env: string) {
  if (env === 'test') {
    return {
      uri: process.env.TEST_MONGO_URI,
      db: process.env.TEST_MONGO_DB,
    };
  }
  return {
    uri: process.env.MONGO_URI,
    db: process.env.MONGO_DB,
  };
}

async function fetchMongo(args: FetchMongoArgs): Promise<LookupResult> {
  const conn = getMongoConfig(args.env);

  if (!conn.uri) {
    throw new Error(`Missing ${args.env === 'test' ? 'TEST_MONGO_URI' : 'MONGO_URI'} environment variable`);
  }
  if (!conn.db) {
    throw new Error(`Missing ${args.env === 'test' ? 'TEST_MONGO_DB' : 'MONGO_DB'} environment variable`);
  }

  const returnFields = args.returnFields
    ? args.returnFields.split(',').map(f => f.trim()).filter(Boolean)
    : [];
  const projection: Record<string, 1> = {};
  for (const field of returnFields) {
    projection[field] = 1;
  }

  const client = new MongoClient(conn.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = client.db(conn.db);
    const collection = db.collection(args.collection);

    let queryValue: string | number = args.query;
    if (!isNaN(Number(args.query))) {
      queryValue = Number(args.query);
    }

    const query = args.lookupField === '_id'
      ? { _id: new ObjectId(args.query) }
      : { [args.lookupField]: queryValue };

    const opts = returnFields.length > 0 ? { projection } : {};
    const doc = await collection.findOne(query, opts) as any;

    if (!doc) {
      return {
        success: false,
        lookupValue: args.query,
        error: `No document with ${args.lookupField}=${args.query} in ${conn.db}.${args.collection}`,
      };
    }

    const result: LookupResult = {
      success: true,
      lookupValue: String(doc[args.lookupField] || args.query),
    };

    const entries = returnFields.length > 0
      ? returnFields.filter(f => doc[f] !== undefined).map(f => [f, doc[f]])
      : Object.entries(doc).filter(([k]) => k !== args.lookupField);

    for (const [key, value] of entries) {
      result[key] = value;
    }

    return result;
  } finally {
    await client.close();
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
  const result = await fetchMongo(args);

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
