# ZaniJS
A out of memory, JSON based database for JavaScript, built as a challenge to see if I could recreate a mongoDB system to be embedded in my other projects, spurred on by the fact I wrote this my second semester of sophmore year whislt taking a DBMS class.


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
I am very happy with how it came out despite this. As a strictly educational, off the clock hobby project to explore database management systems under the hood without any assistance or external research, it did its job rather well. I learned many valuable lessons, mostly of what not to do, that I cannot write this time as a waste by any form of the word. However, I cannot in good faith pretend this project has much deceny in it.

Now that I have come back a year later to revisit and reanalyze this project, I can pick out a number of issues I had failed to notice or didn't understand when originally designing this project.

For isntance, I beleive there are two major issues with this project that are fundamentlly impossible to just "fix." 

The first is the use of javascript. Whilst this was an acceptable choice for the original project, it is far from a good choice generally. Easy to read, yes. However, its single thread based event loop slow most processes, specifically querying, extremely. The lacking of concurrency can be a major bottleneck, as it must sit in the event loop and block the thread from continuing at all rather than causing a wait condition.
Likewise, indexing is spread across many files, so it also runs into this issue since it has to touch many files on a single search.

The second large issue is how data is handled. Each individual entry gets its own file. This was easy to work with, as updated was as simple as overwritting the file. However, this made querying a nightmare, as it constanty hit OS file limits. Likewise, indexing has the same issue. Each node is its own file, thus even indexing is slowed down greatly by the os file limit.

Some other fun issues I've determined.
The codebase, whilst clean in my own opinion and well documented in code, is also full of developer comments and TODO's that will never get TODONE. 
A true AST would be much more efficient in the long term and would be far easier to use from both a user and developer side.

This project has such been abondanded in favor of its next iteration, ArgentDB, in which I will focus on fixing every mistep here and hopefully not have it break everytime something updates. This was determined after learning more of my craft, and not having touched it in four months and coming back to nothing working as intended despite leaving it as, from what I recall, a functional product. 

As such, this would be far easier and much more beneficial to redo properly and fix the underlying archetectual issues than attempt to fix. 

Here's hoping round 2 goes better.