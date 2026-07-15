ZaniJS offers a wide variety of collection functions and features for in-depth control of behaviors, as well as entry specific settings. This page covers everything from adding, updating, and deleting collections, as well as fine tunning behaviors of these functions where applicable. 

A collection is where entries are stored. If a database (project) is a filling cabinet, a collection would be the equivalent of a organized drawer, where an entry would be a piece of paper stored within this cabinet that houses all the data. 

## Error Behavior
When a error occurs during any collection operation, the process will continue without making any changes. If an error occurs during collection deletion, the collection will not be deleted. 

If the option `consoleOptions.consoleLog` is enabled, an error message will be printed to the console. If `consoleOptions.systemLog` is enabled, an error output will be printed to the `audit.log` file. 

All messages will contain a source and cause of error.

If an entry errors out, the entry update, addition, or deletion will be ignored and the process will continue. An error will attempted to be printed as above, but may be vague depending on what constraint caused error. 

The settings `options.autofillAttributes`, if enabled, will have the system autocorrect non-validator options automatically without erroring. 

# Adding a Collection

## Collection Settings
By defining a options object, a collections behavior can be fined tuned or controlled, such as including constraints, validating values for attributes, and creating a structure for a collection and its entries. Below is a list of settings/options that can be set. 

Some settings are collection wide, whilst others are attribute individual, which are denoted by their parent section below.

To define a collection's settings, create a options object as outlined below. 
````js
// Change the collection to have timestamps enabled and have the 
// attribute 'foo' require unique values.
{
	timestamps: true
	attributes: {
		foo: { unique: true }
	}
}
````

Not all settings are required to be in the object, only the ones that shall be set differently than their default behaviors. 

By passing this as the second argument in `Zani.addCollection()`, the settings will be set, and the collection thus created. 

### Settings Reference Table

| Setting                                                    |   Type   | Default | Description                                                                                            |
| :--------------------------------------------------------- | :------: | :-----: | :----------------------------------------------------------------------------------------------------- |
| [[Collections#autofillAttributes\|autofillAttributes]]     | boolean  |  false  | Autofill missing attributes                                                                            |
| [[Collections#allowExtraAttributes\|allowExtraAttributes]] | boolean  |  true   | Allow attributes to be added to entry after creation/insertion into collection                         |
| [[Collections#attributeLock\|attributeLock]]               | boolean  |  false  | Limit attributes to defined values within `opptions.attributes`                                        |
| [[Collections#timestamps\|timestamps]]                     | boolean  |  false  | Adds entry and collection _createdAt and _updatedAt attributes to each entry and collection meta file. |
| [[Collections#domain\|domain]]                             |  object  |  false  | Define a range of permissible values                                                                   |
| [[Collections#enum\|enum]]                                 |  any[]   |  false  | Define a set of permissible values                                                                     |
| [[Collections#outlier\|outlier]]                           |  any[]   |  false  | Define a set of permissible outlier values                                                             |
| [[Collections#dataType\|dataType]]                         |  string  |  false  | Define data type limitations                                                                           |
| [[Collections#pattern\|pattern]]                           |  RegExp  |  false  | Define a expression to validate string input                                                           |
| [[Collections#unique\|unique]]                             | boolean  |  false  | Attribute values must be unique in collection                                                          |
| [[Collections#permitNull\|permitNull]]                     | boolean  |  true   | Allow null as values                                                                                   |
| [[Collections#validator\|validator]]                       | function |  false  | Define custom value validation function                                                                |
| [[Collections#immutable\|immutable]]                       | boolean  |  false  | Attribute value is immutable                                                                           |
| [[Collections#autofillValue\|autofillValue]]               |   any    |  null   | Set autofill value                                                                                     |
| [[Collections#required\|required]]                         | boolean  |  true   | Attribute must appear in all entries                                                                   |
| [[Collections#indexed\|indexed]]                           | boolean  |  false  | Create index on collection creation for attribute                                                      |

### Validation and Constraint Behaviors
Entry and attribute validation occurs during updates and insertions. It will first check to ensure attribute can be updated/inserted, and then will proceed to data validation.

First, check to ensure entry can be modified/updated
1. If update, allowExtraAttributes
2. attributeLock - Ensure attributes match predefined structure
	1. Autofill if necessary

Check each attribute in insertion/update/entry that has changed or added
1.  immutable - ignore attribute or error out
2. required - autofill if necessary, otherwise error out
3. enum - All other checks are ignored if enabled
4. outlier - If contained in outlier, all other checks are ignored
5. dataType - Must match provided datatype.
6. permitNull - Check if null is allowed
7. Depends on datatype
	1. If string, compare pattern
	2. If number, compare domain
8. validator - Compare to custom function
9. unique - Compare to all other values

If any step in attribute validation fails, the entry will error out unless otherwise indicated. 

### Collection-wide Settings
Below settings are applied universally to all entries, regardless of values. These settings are more in line with collection features/functions versus data and attribute control

#### autofillAttributes
**Type:** boolean

The system will fill any required attributes within an entry with an appropriate datatype, if provided by `options.attributes.attribute.autofillValue`, or null if no value is provided.  

This setting ignores `permitNull` and value constraints. 

This setting is disabled by default.

````js
{ autofillAttributes: true } // Enable autofilling of attributes
````

#### allowExtraAttributes
**Type:** boolean

Denotes whether attributes can be added to an entry after creation.
- If false, no attributes outside those at entry creation are permittable and will not be added. 
- If true, entries can have attributes outside that contained within the options attribute section.

If an entry fails to pass this validation check, the entry will error out, or If `options.autofillAttributes` is enabled, the entry will instead truncate to match the original structure.

If this setting is enabled, deletion of attributes can still occur during an update. However, they can not be added back once deleted.

This setting is disabled by default.

````js
{ allowExtraAttributes: false} // Disable extra attributes
`````

#### attributeLock
**Type:** boolean

Determines if a entry can contain attributes outside those within `options.attributes`. If enabled, all entries must contain exactly that which is within `options.attributes`.  

If an entry is missing any attributes, it will be auto filled, if `options.autoFillAttributes` is enabled, or will error out otherwise. 

if an entry contains more attributes than provided structure contains, the entry will be truncated to fit if `options.autofillAttributes` if enabled.

This setting is disabled by default.

````js
{ attributeLock: true } // Enable attribute lock
`````

#### timestamps
**Type:** boolean

The system will maintain a `_createdOn` and `_updatedOn` timestamp, stored as milliseconds since UNIX epoch, via `Date.now()`. These values are individually stored in each entry, and a collection wide version can be found in the collections meta file, accessible through #todo 

This setting is disabled by default.

````js
{ timestamps: true } // Enable timestamp manegment.
`````

### Attribute Specific Options
To set attribute specific options, the attribute must be contained within `options.attributes` object such that, for attributes foo and bar:

````js
{ attributes: {
	foo: {/* Settings go here */}
	bar: {/* Settings go here */}
}}
````

Any attributes contained here are now required attributes. Any entry without any attributes contained within `options.attributes` will be either corrected (`options.autofillAttribtues`) or will be skipped entirely. 

This behavior can be overwritten through attribute specific `required` option. 

By default, no attribute settings are enabled. 

#### domain
**Type:** false | object

Set a numerical or string (Which will be treated as numerical) range for values that they must fall within, with upper and lower bounds for validation. This option has two properties
- lower - Set the lower bound, inclusive. If false, no lower bound will be used.
- upper - Set the upper bound, inclusive. If false, no upper bound will be used.

Both lower and upper values are set to false if domain is included. Otherwise, domain is disabled by default.

>[!note]
>This setting will only apply to values of datatype `number`, and will be ignored otherwise.

````js
{ domain: {
	lower: false // No lower bound used
	upper: 10 // Upper bound of 10 (IE value x<=10)
}}
````

#### enum
**Type:** false | any[]

An array of values of permissible data that can be stored at this attribute. If the array is empty, or false, any value, provided they meet any other constraints will be permitted. 

If this setting is enabled, all other value validation and constraints will be ignored. 

If a value is not contained within enum with this setting enabled, the entry will error out.

By default, this setting is disabled. 

````js
{ enum: [1, 2, 'Value', true] } // Allowed values for attribute
````

#### outlier
**Type:** false | any[]

An array of values of permissible data that can be stored at this attribute. If the array is empty, or false, any value, provided they meet any other constraints will be permitted. 

This field can be used to override other constraints and create 'outliers' that can be added. If a attribute passes this check, it will be deemed valid regardless of other constraints. 

For example, if a domain of 1<=x<=3 is in use, and Enum contains values [10], 10 is a permissible value.

By default, this setting is disabled. 

````js
{ outlier: [1, 2, 'Value', true] } // Allowed outliers for attribute
````

#### dataType
**Type:** false | string

A string identifier used to verify type of data provided for attribute. This value can be any result of the `typeof` operator, `array`, `undefined`, or `null`.

By default, this setting is disabled. 

````js
{ dataType: 'string' } // Allow only string data
````

#### pattern
**Type:** false | RegExp

Compare a regular expression to a string to validate data input for this attribute. If it does not pass, it will error out.

This setting can only be enabled if `options.attributes.datatype` is `String`, otherwise it will disable itself. 

This setting is disabled (false) by default.

>[!note]
>This setting will only apply to values of datatype `string`, and will be ignored otherwise.

````js
{ pattern: '/([A-Z])\w+/g' } // Check that all letters are A-Z
````

#### unique
**Type:** boolean

If true, no other value in this attribute column in any entry in this collection may share values. If a value already exists in the collection, the entry will error out and will not be added. This behaves as a first come, first serve basis on values. 

>[!warning] 
>This setting may result in greater resource utilization due to value checking of all previous entries.

This setting is disabled by default.

````js
{ unique: true } // Enable the unqie setting
````

#### permitNull
**Type:** boolean

If enabled, the system will allow `null` to be used as a permissible data value.  If null is attempted to be passed with this setting disabled, the entry will be errored out.

If `options.autofillAttribute` is enabled, this setting may be ignored if `options.attributes.autofillValue` is disabled or set to null.

This setting is enabled by default. 

````js
{ permitNull: false } // Prevent null from being a value
`````

#### validator
**Type:** false | function

By passing a function in this parameter, a custom validator can be used to ensure data meets specific standards. This function must return a Boolean value, true if passed, false otherwise. If anything other than false/true is returned, the program will treat the response as false and error out regardless.

The function must contain only 1 parameter: the value to be checked, and must be of return type boolean. If the function errors out in any way, Zani will catch it and report.

This setting is disabled by default.

````js
{ validator: 'function(a) {return a<3;}' } // Ensure value is less than 3
````

#### immutable
**Type:** boolean

When enabled, this attribute field cannot be changed or modified after creation. This withstands during updates and deletion to this field, and will only be changed upon entry deletion. 

If `options.autofillAttributes` is enabled, the program will simply ignore this attribute. Otherwise, it will error out upon attempted update to the attribute. 

This setting is disabled by default.

````js
{ immutable: true } // Prevent changes to this fields value
````

#### autofillValue 
**Type:** null | any

If `options.autofillAttributes` is enabled, this fields value will be used to autofill this attribute. This setting ignores all constraints and `permitNull` option, with a default value of `null`.

This field is ignored if `options.autofillAttributes` is false or disabled.

````js
{ autofillValue: 3 } // Autofill this attribute with value 3.
````

#### required
**Type:** boolean

If true, this attribute is required to be present in an entry. This setting can also be used to override default behaviors for attributes contained within `options.attributes` to create attribute options without requiring said attribute.

This setting is enabled by default on any attribute within `options.attributes`.

If a attribute that is required is set to be deleted, the program will either error out or autofill with the denoted autofill value if `options.autofillAttributes` is enabled.

````js
{ required: false } // Make attribute optional
````

#### indexed
**Type:** boolean

If true, an index will be automatically created and maintained for this attribute within this collection at collection creation. This does not determine if a collection is indexed ever, as smart indexing will still occur if this attribute is queried enough times.

A index can be created manually though `Zani.createIndex()` method if later desired.

````js
{ indexed: true } // Create a index for this attribute
````