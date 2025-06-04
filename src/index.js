// Node Imports
const fs = require('fs');

// Custom Import
const Zani = require('./zani');
const BPlusTree = require('./bPlusTree');

/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

var db = new Zani('Test', { fileLimit: 100 });
main();

async function main() {
	//searchTest();
	// await createTestCollection();

	//! Testing note; What happens if a query requests an attribute not present?
	/* 
	! Things to test
	- Uppercase/lowercase on things like $gt -> $Gt/gT
	- Query check, making sure things are used properly rather than just 'where they fit'
	- Test object nesting with more defined data. works as is now in non-indexed files
	*/
	const results = await db.find('Testing', {
		 value: {$gt: 0}
	},
	{
		value: 1
	},
	{
		value: -1
	});
	console.log(results);

	//db.findNonIndexedText('%test%test2___test3%', '', '', '');
}

async function createTestCollection() {
	//db.createCollection('Testing');
	for (let j = 0; j < 40; j++) {
		for (let i = 0; i < 300; i++) {
			db.updateEntry('Testing', {
				_id: i + j * 300,
				nonIndexedValue: i,
			});
		}
		db.logger.warn('File batch ended, pausing', 'Test Server');
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

function searchTest() {
	var result = db.find('NULL', {
		$exists: '_id',
	});

	console.log('\n\n---------------Results---------------');
	console.log(result);
	console.log('\n');
}
