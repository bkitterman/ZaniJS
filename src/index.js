// Node Imports
const fs = require('fs');

/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

// Custom Import
const Zani = require('./zani');
const { resolve } = require('path');
var db = new Zani('Test');
main();

//! WARNING: Zani only works with BASE LEVEL. It cannot consider nested objects. Need fixed.

async function main() {
	//searchTest();
	//await createTestCollection();

}

async function createTestCollection() {
	db.createCollection('Testing');
	for(let j = 0; j<40; j++) {
		for (let i = 0; i < 300; i++) {
			db.addEntry('Testing', { value: i+j*300 });
		}
		db.logger.warn('File batch ended, pausing', 'Test Server');
		await new Promise ((resolve) => setTimeout(resolve, 10));
	}
}

async function searchTest() {
	var result = await db.find('NULL', {
		$exists: '_id',
	});

	console.log('\n\n---------------Results---------------');
	console.log(result);
	console.log('\n');
}
