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

	await db.find('Testing', {
		value: 3,
		insertion: {num: 8}
	});
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
