// Node Imports
import fs from 'fs';

// Custom Import
import { Zani } from './zani.js';

/** This is a basic test file for ZaniJS to ensure it is functioning as intended.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

var db = new Zani('Tester', { path: './here/', fileLimit: 100, throwErrors: true, consoleOptions: { systemLog: false } });
main();

async function main() {
	//! Testing note; What happens if a query requests an attribute not present?
	/* 
	! Things to test
	- Uppercase/lowercase on things like $gt -> $Gt/gT
	- Query check, making sure things are used properly rather than just 'where they fit'
	- Test object nesting with more defined data. works as is now in non-indexed files
	*/
	db.createCollection('Testing');
	db.addEntry('Testing', {value: 1});
}

async function buildDatabase() {
	db.deleteCollection('Testing');
	await new Promise((resolve) => setTimeout(resolve, 1000));

	db.createCollection('Testing');

	for (let j = 0; j < 40; j++) {
		for (let i = 0; i < 300; i++) {
			db.addEntry('Testing', {
				value: i + j * 300,
				nonIndexedValue: j,
				insertion: { num: i * j },
			});
		}
		db.logger.warn('File batch ended, pausing', 'Test Server');
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
