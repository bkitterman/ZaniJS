# ZaniJS
A out of memory, JSON based database for JavaScript, built as a challenge to see if I could recreate a mongoDB system to be embedded in my other projects, spurred on by the fact I wrote this my second semester of sophmore year whislt taking a DBMS class.

At present, there is a high likelyhood this project is no longer functional.

# Installaion
To run this program, ensure a windows machine with Node.js version v22 or equivilant. 

It is recomended to create a main.js file, and import Zani from Zani.js. However, it is also possible to modify the zaniDev.js file as well. 

To run this program, simply use

```bash
node file.js # Replace file with file name.
```

# Features
- Query system based on MongoDB syntax.
- Attribute indexing
- Collection wide settings for schema validation.
- Entry data validation
- File-backed, document based storage.

# Query
Queries must taake the form of 
```json
{
    attribute: value // For EQ shorthand
    attribute: {$op: value} // For specific operators
    attribute: {$op1: {
        $op2a: value, 
        $op2b: value // For nested operators
    }}
}
```

Accepted operators include:
$gt: Greater than
$gte: Greater than equal to
$lt: Less than
$lte: Less than equal to
$eq: Equal to
$ne: Not equal to
$in: Includes / Contains
$nin: Not in / Not Contained
$text: Text Matching

$exists: Attribute Exists check
$type: Attribute type check

$and: Logical And
$or: Logical Or
$not: Logical Not
$nand: Logical Nand
$nor: Logical Nor
$xor: Logical Xor
$count: Count entries

# Afterthoughts
This project is, as politely as I can state, a hot mess. Whilst it does function, it breaks constantly due to a minefield of issues, and is incredibly slow due to each file storing one entry. Thus, OS file limits become the bane of user experience. 

Likewise, indexing is spread across many files, so it also runs into this issue since it has to touch many files on a single search.

This was also written in JS. Whilst useful for the projects this was intended to supplement, it is horrible choice for this project otherwise.

The codebase, whilst clean in my own opinion and well documented in code, is also full of developer comments and TODO's that will never get TODONE. 

This project has such been abondanded in favor of its next iteration, ArgentDB, in which I will focus on fixing every mistep here and hopefully not have it break everytime something updates. This was determined after learning more of my craft, and not having touched it in four months and coming back to nothing working as intended despite leaving it as, from what I recall, a shippable (but bad) product. 

Here's hoping round 2 goes better.