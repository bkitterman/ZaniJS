// Node Imports
const fs = require('fs');

// Custom Import
const Zani = require('./zani');

/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

var db = new Zani('Test');
main();

async function main() {
	//searchTest();
	// await createTestCollection();

	//! Testing note; What hapopens if a query requests an attribute not present?
	/* 
	! Things to test
	- FIRST: Test all non-indexed methods
	- Uppercase/lowercase on things like $gt -> $Gt/gT
	- Query check, making sure things are used properly rather than just 'where they fit'
	- Test object nesting with more defined data. works as is now in non-indexed files
	*/
	await db.find('PlaceHolder', {
		// Next test
	});

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
