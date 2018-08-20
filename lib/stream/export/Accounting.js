
var stream = require('stream');
var util = require("util");
var NodeProcessor = require("../NodeProcessor");

function Accounting(options) {
  if (!options) { options = {}; }
  options.objectMode = true;
  NodeProcessor.call(this, options);
  this.accounts = {};
  this.accountNumbers = {};
  this.sheets = {};
  this.entries = [];

  this.type = "start";
  this.name = this.tagCommandPrefix + "object";
}

util.inherits(Accounting, NodeProcessor);

Accounting.prototype.tagCommandPrefix = "accounting:";

// Accounting.prototype._flush = function (done) {
//   console.log("flushing");

//   this.sendEvent(this);
//   this.sendEvent({ type: "end" });

//   NodeProcessor.prototype._flush.apply(this, arguments);
// };

////////////////////////////////////////////////////////////////////////////////
// NODE COMMANDS

/**
 * Declaring an account (with path, number, comment) for use in entries
 */
Accounting.prototype.command_account = function(event) {
  var account = Object.assign({}, event.attributes);

  if (account.path) {
    if (account.path[0] != "/") {
      this.warn("Invalid account name (not starting with a '/'): " + account.path);
      return;
    }
    if (this.accounts[account.path]) {
      throw new Error("Account declared multiple times: " + account.path);
    }
    if (account.number && this.accountNumbers[account.number]) {
      throw new Error("Dupplicate account number: " + account.number);
    }

    this.accounts[account.path] = account;
    if (account.number) {
      this.accountNumbers[account.number] = account.path;
    }
  }

  this.captureLevelEvents(true).done();
};

/**
 * Declaring a sheet column (value column, label columns, etc.)
 */
Accounting.prototype.command_sheet_column = function(event) {
  // this.log(":sheet-column --", JSON.stringify(event));
  var column = Object.assign({}, event.attributes);
  if (column.sheet) {
    if (!column.column) {
      throw new Error("No column defined for sheet '"+column.sheet+"' in meta sheet");
    }
    if (column.type == "value" &&
        (!column.account || !/^[-+*]/.test(column.account))) {
      throw new Error("Invalid account spec ('"+column.account+"') for sheet '"+column.sheet+
                      "' in meta sheet, column '"+column.column+
                      "' (should start with '+', '-', or '*'");
    }
    if (!this.sheets[column.sheet]) {
      this.sheets[column.sheet] = { name: column.sheet, columns: {}, nthRow: 1 };
    }

    this.sheets[column.sheet].columns[column.column] = column;
  }

  this.captureLevelEvents(true).done();
};

/**
 * Declaring a sheet row
 */
Accounting.prototype.command_sheet_row = function(event) {
  var row = Object.assign({}, event.attributes);
  if (!row.sheet) {
    throw new Error("missing attribute 'sheet' for "+this.tagCommandPrefix+"sheet-row");
  }
  var sheet = this.sheets[row.sheet];
  if (!sheet) {
    this.warn("sheet does not exist: "+row.sheet);
    return;
  }
  sheet.nthRow++;
  var entry = { sheet: sheet.name, row: sheet.nthRow, assignment: {} };

  Object.keys(sheet.columns).forEach(function(name) {
    var column = sheet.columns[name];
    var value = row[name];
    if (value === undefined) {
      throw new Error("column "+name+" missing for sheet '"+sheet.name+
                      "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));
    }
    switch (column.type) {
    case 'date':
      entry.date = new Date(value);
      break;

    case 'label':
      entry.label = entry.label ? entry.label+"\n" : "";
      entry.label += value;
      break;

    case 'value':
      // this.log("*account", column.column, column.account, "** VALUE", value);
      var amount;
      if (value == "") {
        amount = -1 * Object.keys(entry.assignment)
          .reduce(function(acc, cur) { return acc + entry.assignment[cur]; }, 0);

      } else {
        amount = parseFloat(value.replace(/,/, '.'));
        if (Number.isNaN(amount)) {
          throw new Error("accounting: invalid amount value ('"+value+"') on sheet '"+
                          sheet.name+"', column '"+name+"' for row n°"+sheet.nthRow+": "+
                          JSON.stringify(row));
        }
      }
      var account = column.account.substring(1);

      switch (column.account[0]) {
      case '+': break;
      case '-': amount *= -1; break;
      case '*':
        if (!row[account]) {
          account = null;
          break;
          // throw new Error("accounting: account column '"+account+"') undeclared on sheet '"+
          //                 sheet.name+"' for row n°"+sheet.nthRow+": "+ JSON.stringify(row));
        }
        // this.log("*account", account, row[account]);
        account = row[account];
        break;
      default:
        this.warn("accounting meta: invalid account prefix ('"+column.account[0]+"') for sheet "+
                  sheet.name+", column "+name+"");
      }
      if (account) {
        if (!this.isAccountValid(account, true)) {
          this.warn("accounting: invalid account '"+account+"' for sheet "+
                    sheet.name+", column "+name+" on row n°"+sheet.nthRow+": "+JSON.stringify(row));
        }
        entry.assignment[account] = amount;
      }
      break;
    default:
      this.warn("accounting meta: invalid type for sheet "+sheet.name+
                ", column "+name+"");
    }
  }, this);
  if (!entry.date || !entry.label) {
    throw new Error("date or label not declared for sheet '"+sheet.name+
                    "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));
  }
  if (!Object.keys(entry.assignment).length) {
    throw new Error("accounting: no account assigned on entry for sheet '"+sheet.name+
                    "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));
  }
  this.entries.push(entry);
  // this.sheets[row.sheet].rows.push(row);

  this.captureLevelEvents(true).done();
};

/* NOTES

 rassembler en écritures direct ? oui sans doute
 écriture : { date(date), label (string dont \n), affectation: { accountPath: amount(number) }}
 ensuite : à trier

 synthétisé :
 { date(date), label (string dont \n), accounts: { accountPath: { amount(number), balance(number) }}}
 OU:
 { date(date), label (string dont \n), assignment: { accountPath: amount(number) }, balance: balance: { accountPath: amount(number) }}

 en 2 temps :
 - constitution de la liste, selon source (feuille par feuille)
 - tri et itération pour mise à jour des soldes à chaque écriture
 - éventuellement, constitution de synthèses mensuelles (avant le 1er de chaque mois), en référençant simplement la dernière écriture du mois (

 itérations selon comptes: naïf, à optimiser selon perfs

 soldes : gérés par écriture (à jour de chaque compte)
 ***
 le solde est un effet d'itération, il peut être établi à différent niveaux d'agrégation
 DONC il n'y a pas de rassemblement préalable par compte

 */

////////////////////////////////////////////////////////////////////////////////
// Functions accessible from node (through command_as)

Accounting.prototype.formatDate = function(date) {
  return date.toISOString().substr(0, 10);
};
Accounting.prototype.formatLabel = function(label, mode) {
  if (mode === "html") {
    label = label.replace(/\n/g, "<br/>");
  }
  return label;
};
Accounting.prototype.formatValue = function(value) {
  if (value === null) { return "(null)"; }
  if (value === undefined) { return "(undefined)"; }
  if (Number.isNaN(value)) { return "(Not a Number)"; }

  // value = parseInt(value * 100) / 100;
  var sign = "";
  if (value < 0) { sign = "–"; value *= -1; }

  return (""+sign+value.toFixed(2)).replace(/\./, ",");
};

Accounting.prototype.getAccounts = function(withAggregate) {

  // var lastPath = "";
  var lastPathArr = [];
  var accounts = [];

  Object.keys(this.accounts)
    .forEach(function(path) {

      var pathArr = path.split("/");

      for (var i = 0; i < pathArr.length && i < lastPathArr.length && pathArr[i]==lastPathArr[i]; i++)
        ;;
      for (var i2 = i + 1; i2 < pathArr.length; i2++) {
        accounts.push({
          path: pathArr.slice(0, i2).join("/")+"/",
          commonPath: i2 > 1 ? pathArr.slice(0, i2 - 1).join("/")+"/" : "",
          relativePath: pathArr[i2 - 1]+"/",
        });
      }

      accounts.push(Object.assign({
        commonPath: pathArr.slice(0, pathArr.length - 1).join("/")+"/",
        relativePath: pathArr[pathArr.length - 1]
      },this.accounts[path]));

      lastPathArr = pathArr;
    }, this);

  // accounts.forEach(function(a) { console.log("+++ "+a.path+" +++ "+a.relativePath+" +++ "+a.commonPath); });
  return accounts;
};

Accounting.prototype.getAccount = function(path) {

  var account;
  if (typeof path == 'object') { path = path.path; }

  if (/\/$/.test(path)) {
    account = {
      path: path, isAggregate: true, accounts: {},
      matchAccount: function(eAccount) {
        return eAccount.startsWith(path);
      }
    };

    Object.keys(this.accounts).forEach(function(path2) {
      if (path2.startsWith(path)) {
        account.accounts[path2.substring(path.length)] = this.accounts[path2];
      }
    }, this);
    if (!Object.keys(account.accounts).length) {
      throw new Error("aggregate account does not match any declared account: "+path);
    }

  } else {
    if (!this.accounts[path]) {
      throw new Error("account does not exist: "+path);
    }
    account = Object.assign({}, this.accounts[path]);
    account.matchAccount = function(eAccount) {
      return eAccount == path;
    };

  }
  account.matchEntry = function(entry) {
    return Object.keys(entry.assignment)
      .some(account.matchAccount);
  };

  return account;
};

Accounting.prototype.getSheets = function() {

  return Object.keys(this.sheets)
    .map(function(name) { return this.sheets[name]; }, this);
};

Accounting.prototype.isAccountValid = function(account, andConcrete) {

  if (andConcrete && /\/$/.test(account)) { return false; }

  return !!this.accounts[account];
};

Accounting.prototype.getEntries = function() {
  this.sealEntries();

  return this.entries;
};

Accounting.prototype.getAccountEntries = function(account) {
  this.sealEntries();
  var balance = 0;

  if (!account.matchEntry) { account = this.getAccount(account); }

  return this.entries
    .filter(account.matchEntry)
    .map(function(entry) {
      entry = Object.assign({
        accountDebit: 0,
        accountCredit: 0,
        accountValue: 0,
        accountBalance: 0,
      }, entry);

       Object.keys(entry.assignment).forEach(function(cur) {
        if (account.matchAccount(cur)) {
          entry.accountValue += entry.assignment[cur];
          if (entry.assignment[cur] < 0) {
            entry.accountDebit += -1 * entry.assignment[cur];
          } else {
            entry.accountCredit += entry.assignment[cur];
          }
        }
      });
      balance += entry.accountValue;
      entry.accountBalance = balance;

      return entry;
    }, this);
};

/**
 * TODO: select period
 */
Accounting.prototype.getAccountStats = function(account) {
  this.sealEntries();
  var stats = {
    debit: 0,
    credit: 0,
    balance: 0,
    entries: 0
  };

  if (!account.matchEntry) { account = this.getAccount(account); }

  this.entries
    .filter(account.matchEntry)
    .forEach(function(entry) {
      var value = Object.keys(entry.assignment).reduce(function(acc, cur) {
        if (account.matchAccount(cur)) {
          acc = acc + entry.assignment[cur];
        }
        return acc;
      }, 0);
      if (value < 0) { stats.debit -= value; } else { stats.credit += value; }
      stats.balance += value;
      stats.entries++;
    }, this);

  return stats;
};


////////////////////////////////////////////////////////////////////////////////
// Implementation functions

Accounting.prototype.sealEntries = function() {
  if (!this.sealedEntries) {
    this.sealedEntries = true;
    this.entries.sort(
      function(a, b) { return a.date == b.date ? 0 :
                       a.date < b.date ? -1 : 1; });
  }
};

////////////////////////////////////////////////////////////////////////////////

module.exports = Accounting;

// this.sendEvent({ type: "start", name: "b", attributes: {"class":"toto"}});
// this.sendEvent({ type: "text", text: "mouhaha" });
// this.sendEvent({ type: "end" });
