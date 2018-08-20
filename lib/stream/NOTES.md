# Development notes

## Events

- type: "start", name, attributes
- end
- type: "text", text
- type: "message", level, message


## Classes

### NodeProcessor

- Stream classes that process nodes (input nodes, output nodes)
  inherit from NodeProcessor (like: ProcessNodes, Accounting)

- Function "sendEvent" has to be called to send content out. Examples:

    - this.sendEvent({
        type: "start",
        name: "div",
        attributes: {"class": "toto"}
      })

    - this.sendEvent({ type: "end" })
