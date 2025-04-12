/** This is a basic test file for ZaniJS to ensure it is functioning as intended. 
 * 
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */

// Custom Import
const Zani = require("./zani");

var db = new Zani();
db.addCollection("Test34");
db.setDatabase("Test");
db.addCollection();
