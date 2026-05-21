#!/usr/bin/env tsx
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

import type { FetchUidArgs, UidResult } from './lib/types';

function parseArgs(argv: string[]): FetchUidArgs {
  const out: FetchUidArgs = {
    userNo: '',
    json: false,
    env: 'prod',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--userNo' && next) {
      out.userNo = next;
      i += 1;
    } else if (cur === '--env' && next) {
      out.env = next;
      i += 1;
    } else if (cur === '--json') {
      out.json = true;
    }
  }

  if (!out.userNo) {
    throw new Error('Missing required --userNo');
  }

  return out;
}

function getMongoConfig(env: string) {
  if (env === 'test') {
    return {
      uri: process.env.TEST_MONGO_URI,
      db: process.env.TEST_MONGO_DB,
      collection: process.env.TEST_MONGO_COLLECTION,
      lookupField: process.env.TEST_MONGO_LOOKUP_FIELD || 'userNo',
      returnFields: process.env.TEST_MONGO_RETURN_FIELDS || '_id,userNo,nickName,userName',
    };
  }
  return {
    uri: process.env.MONGO_URI,
    db: process.env.MONGO_DB,
    collection: process.env.MONGO_COLLECTION,
    lookupField: process.env.MONGO_LOOKUP_FIELD || 'userNo',
    returnFields: process.env.MONGO_RETURN_FIELDS || '_id,userNo,nickName,userName',
  };
}

async function fetchUid(userNo: string, env: string): Promise<UidResult> {
  const config = getMongoConfig(env);

  if (!config.uri) {
    throw new Error(`Missing ${env === 'test' ? 'TEST_MONGO_URI' : 'MONGO_URI'} environment variable`);
  }
  if (!config.db) {
    throw new Error(`Missing ${env === 'test' ? 'TEST_MONGO_DB' : 'MONGO_DB'} environment variable`);
  }
  if (!config.collection) {
    throw new Error(`Missing ${env === 'test' ? 'TEST_MONGO_COLLECTION' : 'MONGO_COLLECTION'} environment variable`);
  }

  const returnFields = config.returnFields.split(',').map(f => f.trim()).filter(Boolean);
  const projection: Record<string, 1> = {};
  for (const field of returnFields) {
    projection[field] = 1;
  }

  const client = new MongoClient(config.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = client.db(config.db);
    const collection = db.collection(config.collection);

    let queryValue: string | number = userNo;
    if (!isNaN(Number(userNo))) {
      queryValue = Number(userNo);
    }

    const query = config.lookupField === '_id'
      ? { _id: new ObjectId(userNo) }
      : { [config.lookupField]: queryValue };

    const user = await collection.findOne(query, { projection }) as any;

    if (!user) {
      return {
        success: false,
        lookupValue: userNo,
        uid: null,
        error: `User with ${config.lookupField}=${userNo} not found in ${config.db}.${config.collection}`,
      };
    }

    const uid = String(user._id || '');
    const result: UidResult = {
      success: true,
      lookupValue: String(user[config.lookupField] || userNo),
      uid,
    };

    for (const field of returnFields) {
      if (field !== '_id' && field !== config.lookupField && user[field] !== undefined) {
        result[field] = user[field];
      }
    }

    return result;
  } finally {
    await client.close();
  }
}

function printHumanOutput(result: UidResult): void {
  if (!result.success) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`${result.lookupValue} -> uid: ${result.uid}`);
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'success' && key !== 'lookupValue' && key !== 'uid') {
      console.log(`${key}: ${value}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchUid(args.userNo, args.env);

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
