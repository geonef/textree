# Textree stream classes available to Textree content

All javascript files in this directory are classes based on either
stream.Readable, stream.Writable or stream.Transform (see:
[NodeJS Stream API](https://nodejs.org/api/stream.html)).


##  For use by the Textree :process instruction

In textree code, the instruction ```:process.GenerateChars``` will
instanciate the class found in ```export/GenerateChars.js```, for
example.

The ```:process``` instruction (managed in ```ProcessNodes.js```)
clones itself to process the content nested below the ```:process```
tag and send the output to the stream class.

Any output from the stream class (like ```GenerateChars```) is also
processed, in the parent ```ProcessNodes```. The clone is destroyed
when the ```:process``` tag closes.


## Incomplete list of stream modules

|Module|Input|Output|Description|
|------|-----|------|-----------|
|[GenerateChars](GenerateChars.js)|*(none)*|Random chars (text)|Generate N random chars (4242 by default between A and B|
|[ParseTextree](ParseTextree.js)|Raw textree tag tree (text)|textree events|Parse textree syntax into events|
|[PrintCsv](PrintCsv.js)|csv:* tags (events)|CSV content (text)|Print CSV using specific csv: tags|
|[PrintJson](PrintJson.js)|any events|events serialized as JSON (text)|Useful for learning and debugging|
|[PrintXml](PrintXml.js)|events|Event tree printed as XML (text)|Used to format XML and HTML documents from textree parsing or processing|
|[ProcessNodes](ProcessNodes.js)|events|events|Passthrough while processing ```:*``` instructions|
|[ReadFile](ReadFile.js)|fs:path and fs:glob events|file content (text)|Read a file (from the Git repository)|

