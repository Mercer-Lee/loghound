#!/usr/bin/env node

/**
 * User ID lookup script — configurable MongoDB query
 *
 * Usage:
 *   node scripts/fetch-uid.js --userNo 12345
 *   node scripts/fetch-uid.js --userNo 12345 --json
 *
 * Environment variables:
 *   MONGO_URI           - MongoDB connection string (required)
 *   MONGO_DB             - Database name (required)
 *   MONGO_COLLECTION     - Collection name (required)
 *   MONGO_LOOKUP_FIELD   - Field to match against (default: userNo)
 *   MONGO_RETURN_FIELDS  - Fields to return, comma-separated (default: _id,userNo,nickName,userName)
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

function parseArgs(argv) {
  const out = {
    userNo: '',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--userNo' && next) {
      out.userNo = next;
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

async function fetchUid(userNo) {
  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB;
  const collectionName = process.env.MONGO_COLLECTION;
  const lookupField = process.env.MONGO_LOOKUP_FIELD || 'userNo';
  const returnFieldsStr = process.env.MONGO_RETURN_FIELDS || '_id,userNo,nickName,userName';

  if (!uri) {
    throw new Error('Missing MONGO_URI environment variable');
  }
  if (!dbName) {
    throw new Error('Missing MONGO_DB environment variable');
  }
  if (!collectionName) {
    throw new Error('Missing MONGO_COLLECTION environment variable');
  }

  const returnFields = returnFieldsStr.split(',').map(f => f.trim()).filter(Boolean);
  const projection = {};
  for (const field of returnFields) {
    projection[field] = 1;
  }

  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    const query = { [lookupField]: isNaN(Number(userNo)) ? userNo : Number(userNo) };
    const user = await collection.findOne(query, { projection });

    if (!user) {
      return {
        success: false,
        lookupValue: userNo,
        uid: null,
        error: `User with ${lookupField}=${userNo} not found in ${dbName}.${collectionName}`,
      };
    }

    const uid = String(user._id || '');
    const result = {
      success: true,
      lookupValue: String(user[lookupField] || userNo),
      uid,
    };

    for (const field of returnFields) {
      if (field !== '_id' && field !== lookupField && user[field] !== undefined) {
        result[field] = user[field];
      }
    }

    return result;
  } finally {
    await client.close();
  }
}

function printHumanOutput(result) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchUid(args.userNo);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHumanOutput(result);
  }

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
