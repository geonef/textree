
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
Accounting.prototype.waitAccount = "/__ATTENTE__";


////////////////////////////////////////////////////////////////////////////////
// NODE COMMANDS

/**
 * Declaring an account (with path, number, comment) for use in entries
 */
Accounting.prototype.command_account = function(event) {
  this.captureLevelEvents(true)
    .then(function() {
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
    }.bind(this))
    .done();
};

/**
 * Declaring a sheet column (value column, label columns, etc.)
 */
Accounting.prototype.command_sheet_meta = function(event) {
  // this.log(":sheet-column --", JSON.stringify(event));
  this.captureLevelEvents(true)
    .then(function() {
      var meta = Object.assign({}, event.attributes);
      var sheetName = meta.sheet;
      if (sheetName) {
        if (!this.sheets[sheetName]) {
          this.sheets[sheetName] = {
            name: sheetName, nthRow: 1,
            accounts: [], replacements: []
          };
        }
        var sheet = this.sheets[sheetName];
        ['sheet', 'date', 'label', 'doc', 'join_sheet',
         'join_target_match'].forEach(function(prop) {
           if (meta[prop]) {
             sheet[prop] = meta[prop];
           }
         }, this);
        if (meta.account) {
          var account = {};
          ['account', 'amount', 'if_empty'].forEach(function(prop) {
            if (meta[prop]) {
              account[prop] = meta[prop];
            }
          }, this);

          sheet.accounts.push(account);
        }
      }
    }.bind(this))
    .done();
};

/**
 * Add a replacement
 */
Accounting.prototype.command_sheet_replace = function(event) {
  var replace = Object.assign({}, event.attributes);
  if (!replace.target_column) {
    this.warn("Replacement: 'target_column' not defined, event = "+JSON.stringify(event));
  } else if (!this.sheets[replace.sheet]) {
    this.warn("Invalid sheet on replacement: "+replace.sheet);
  } else {
    this.sheets[replace.sheet].replacements.push(replace);
  }

  this.captureLevelEvents(true).done();
};

/**
 * Declaring a sheet row
 */
Accounting.prototype.command_sheet_row = function(event) {
  // console.log("command_sheet_row");
  this.captureLevelEvents(true).then(function() {
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

    sheet.replacements.forEach(function(replacement) {
      var expr;
      if (/^[<>]/.test(replacement.match)) {
        var compare;
        if (replacement.match[0] == '<') {
          compare = function(a, b) { return a < b; };
        } else {
          compare = function(a, b) { return a > b; };
        }
        var val = replacement.match.substring(1).trim();
        if (val == 'TODAY') {
          val = this.formatDate(new Date());
        }
        expr = { test: function(str) { return compare(str, val); } };
      } else {
        expr = new RegExp(replacement.match, 'i');
      }
      if (expr.test(row[replacement.column])) {
        // this.log("regexp TRUE ("+replacement.match+") on row '"+
        //          replacement.column+"': "+row[replacement.column]);
        row[replacement.target_column] =
          this.templateReplace(replacement.target_value, row, sheet);
      }
    }, this);

    var dateStr = this.templateReplace(sheet.date, row, sheet).trim();
    var date = this.parseDate(dateStr);
    if (!date) {
      return; // ignore rows with no date (even if join), also ignore if invalid date
    }
    if (date > Date.now()) {
      this.warn("date in the future (ignored!) in sheet '"+sheet.name+
                "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));
      return;
    }
    var label = this.templateReplace(sheet.label, row, sheet);
    var entry; // will be created or found in join sheet

    //
    if (sheet.join_sheet) {


      for (var i = this.entries.length - 1; i >= 0; --i) {
        var _entry = this.entries[i];
        // this.warn("sheet", _entry.sheet, sheet.join_sheet, sheet.join_target_match, JSON.stringify(_entry.source));
        // if (_entry.sheet == sheet.join_sheet) {
        //   this.warn('MATCH', label, '--', this.templateReplace(sheet.join_target_match, _entry.source,
        //                                                        this.sheets[_entry.sheet]));
        // }
        if (_entry.sheet == sheet.join_sheet &&
            // _entry.date == date &&
            label == this.templateReplace(sheet.join_target_match, _entry.source,
                                          this.sheets[_entry.sheet])) {

          // this.log("MERGED!!!!!");
          entry = _entry;
          entry.merged = true;
        }
      }
      if (!entry) {
        this.warn("row n°"+sheet.nthRow+" on sheet '"+sheet.name+
                  "' could not be joined with sheet '"+sheet.join_sheet+
                  "' (match value: '"+label+"'");
        return;
      }
    } else { // sheet.join_sheet

      entry = { sheet: sheet.name, row: sheet.nthRow,
                date: date,
                label: label, doc: "",
                assignment: {}, source: row };
    }

    if (sheet.doc) {
      entry.doc = (entry.doc ? entry.doc+"\n":"") +
        this.templateReplace(sheet.doc, row, sheet);
    }
    // console.log("***** entry.label", sheet.label, entry.label);

    sheet.accounts.forEach(function(accountSpec) {
      var account = this.templateReplace(accountSpec.account, row, sheet);

      if (account) {
        if (!this.isAccountValid(account, true)) {
          this.warn("accounting: invalid account '"+account+"' for sheet "+
                    sheet.name+", spec "+accountSpec.account+
                    " on row n°"+sheet.nthRow+": "+JSON.stringify(row));
          return;
        }

        var amountStr = this.templateReplaceValue(accountSpec.amount, row, sheet).replace(/,/, '.');
        var amount;
        var balance = Object.keys(entry.assignment)
              .reduce(function(acc, cur) { return acc + entry.assignment[cur]; }, 0);

        // this.warn("amountStr", account, accountSpec.amount, "--", amountStr);
        if (/^[-+]? *%? *$/.test(amountStr)) { // empty value or percentage
          var if_empty = this.templateReplaceValue(accountSpec.if_empty, row, sheet);
          if (if_empty) {
            amountStr = if_empty;
          } else {
            return; // ignore account affect
          }
        }
        if (/.*% *$/.test(amountStr)) { // percentage
          amount = this.parseValue(amountStr.replace(/% *$/, ""), row,
                                   sheet, accountSpec.amount) * -balance / 100;
          // this.warn("PERCENT", amountStr, "=", amount, 'of balance', balance, entry.label);
        } else {
          amount = this.parseValue(amountStr, row, sheet, accountSpec.amount);
        }
        // this.warn("***** amountStr", amountStr, amount);
        if (Number.isNaN(amount)) {
          return;
          // throw new Error("sheet-row: invalid amount value ('"+amountStr+"') on sheet '"+
          //                 sheet.name+"', amount spec '"+accountSpec.account+
          //                 "' for row n°"+sheet.nthRow+": "+JSON.stringify(row));
        }
        if (!this.isAmountNull(amount)) {
          if (!entry.assignment[account]) {
            entry.assignment[account] = 0;
          }
          entry.assignment[account] += amount;
        }
      }
    }, this);

    if (!entry.date) {
      this.warn("date not declared for sheet '"+sheet.name+
                "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));
    } else if (!entry.label) {
      this.warn("label not declared for sheet '"+sheet.name+
                "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));

    } else if (!Object.keys(entry.assignment).length) {
      this.warn("accounting: no account assigned on entry for sheet '"+sheet.name+
                "' on row n°"+sheet.nthRow+": "+JSON.stringify(row));

    } else if (!entry.merged) {
      this.entries.push(entry);
    }
    // this.sheets[row.sheet].rows.push(row);
  }.bind(this)).done();
};


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
Accounting.prototype.formatValue = function(value, type) {
  if (value === null) { return "(null)"; }
  if (value === undefined) { return "(undefined)"; }
  if (Number.isNaN(value)) { return "(Not a Number)"; }

  if (type == "raw") {
    return ""+value.toFixed(2);
  }

  // value = parseInt(value * 100) / 100;
  var sign = "";
  if (value < 0) { sign = "–"; value *= -1; }
  value = value.toFixed(2);

  for (var i = value.length - 6; i > 0; i -= 3) {
    // insert spaces between groups of 3 digits
    value = value.substring(0, i)+" "+value.substring(i);
  }
  return (""+sign+value).replace(/\./, ",");
};
Accounting.prototype.parseValue = function(value, row, sheet, spec) {
  var number = parseFloat(value.replace(/,/, '.'));
  if (Number.isNaN(number) && row && sheet) {
    this.warn("accounting: parseValue(): invalid amount value ('"+value+"') on sheet '"+
              sheet.name+"', amount spec '"+(spec||'(unknown)')+
              "' for row n°"+sheet.nthRow+": "+JSON.stringify(row));
  }

  return number;
};
Accounting.prototype.parseDate = function(value, row, sheet, spec) {
  if (value) {
    value = new Date(value);
  } else {
    value = null;
  }
  return value;
};

Accounting.prototype.templateReplace = function(template, row, sheet) {
  return (template || "")
    .replace(/{([^}]+)}/g, function(match, columnSpec) {

      try {
        var parts = columnSpec.split('|');
        if (!(parts[0] in row)) {
          this.warn("column "+parts[0]+" not defined for label template of sheet '"+sheet.name+
                    "', on row n°"+sheet.nthRow+": "+JSON.stringify(row));
          return "";
        }
        var value = row[parts[0]] || '';
        parts.shift();
        parts.forEach(function(part) {
          switch (part.replace(/\?$/, '')) {
          case 'lower': value = value.toLowerCase(); break;
          case 'upper': value = value.toUpperCase(); break;
          case 'number': if (value) { this.parseValue(value, row, sheet); } break;
          case 'date': if (value) { this.parseDate(value, row, sheet); } break;
          case 'format':
            if (typeof value == 'number') { value = this.formatValue(); }
            else if (value instanceof Date) { value = this.formatDate(); }
            else { value = ''+value; }
            value = this.formatLabel(value);
            break;
          default: this.warn("invalid template option '"+part+"' in template '"+template+"'");
          }
        }, this);

        return ''+value;
      }
      catch (e) {
        this.warn("error caught in template replacement ('"+template+"') at expr '"+
                  columnSpec+"': "+ e.name + ": " + e);
        return "";
      }
    }.bind(this));
};

Accounting.prototype.templateReplaceValue = function(template, row, sheet) {
  return this.templateReplace(template, row, sheet)
    .replace(/--/, '+').replace(/\+-/, '-').replace(/-\+/, '-');
};

Accounting.prototype.getAccounts = function(withAggregate) {

  // var lastPath = "";
  var lastPathArr = [];
  var accounts = [];

  this.sealEntries();

  Object.keys(this.accounts)
    .forEach(function(path) {

      var pathArr = path.split("/");

      for (var i = 0; i < pathArr.length && i < lastPathArr.length && pathArr[i]==lastPathArr[i]; i++)
        ;;
      for (var i2 = i + 1; i2 < pathArr.length; i2++) {
        accounts.push({
          isAggregate: true,
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

  this.sealEntries();

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
 * month
 *
 * @param {string} account      Account spec (real or aggregate)
 */
Accounting.prototype.getAccountPeriodicStats = function(account/*, balances*/) {
  this.sealEntries();
  if (!account.matchEntry) { account = this.getAccount(account); }

  var stats = { isAggregate: account.isAggregate, subAccounts: [],
                periods: [], monthly: {}, global: {},
                accountsPositive: [], accountsNegative: [] };
  var value;
  var earliestDate, latestDate;

  function date2period(date) {
    return (date.getFullYear() % 100)+"-"+("0"+(date.getMonth()+1)).substr(-2);
  }

  this.entries
    .filter(account.matchEntry)
    .forEach(function(entry) {

      if (!earliestDate) { earliestDate = entry.date; }
      latestDate = entry.date;

      var period = date2period(entry.date);
      if (!value || value.period != period) {

        value = { period: period, _balance: value ? value._balance : 0, _global: 0 };
        stats.monthly[period] = value;
      }

      Object.keys(entry.assignment).forEach(function(cur) {

        if (account.matchAccount(cur)) {
          if (account.isAggregate) {
            var childAccount = cur.slice(account.path.length);
            if (childAccount.indexOf("/") != -1) {
              childAccount = childAccount.replace(/\/.*/, '/');
            }
          } else {
            childAccount = "_";
          }
          if (stats.subAccounts.indexOf(childAccount) == -1) {
            stats.subAccounts.push(childAccount);
          }
          if (!value[childAccount]) {
            value[childAccount] = { amount: 0 };
          }
          value[childAccount].amount += entry.assignment[cur];
          value._balance += entry.assignment[cur];
          value._global += entry.assignment[cur];
        }
      }, this);

    }, this);

  stats.subAccounts.sort();
  stats.subAccounts.forEach(function(account) { stats.global[account] = 0; });

  for (var date = new Date(earliestDate.valueOf()); date <= latestDate; date.setMonth(date.getMonth() + 1)) {
    var period = date2period(date);
    stats.periods.push(period);
    // remplir les "trous" (balance des comptes sur les mois sans mouvement)
    if (!stats.monthly[period]) { stats.monthly[period] = {}; } // This should NOT be needed (is it?)
    stats.subAccounts.forEach(function(account) {
      if (stats.monthly[period][account]) {
        stats.global[account] += stats.monthly[period][account].amount;
      } else {
        stats.monthly[period][account] = {};
      }
      stats.monthly[period][account].balance = stats.global[account];
      if (stats.global[account] > 0 && stats.accountsPositive.indexOf(account) == -1) {
        stats.accountsPositive.push(account);
      }
      if (stats.global[account] < 0 && stats.accountsNegative.indexOf(account) == -1) {
        stats.accountsNegative.push(account);
      }
    });
  }

  return stats;
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
    this.entries.sort(
      function(a, b) { return a.date == b.date ? 0 :
                       a.date < b.date ? -1 : 1; });
    for (var i = 0; i < this.entries.length; i++) {
      var entry = this.entries[i];
      var balance = Object.keys(entry.assignment)
            .reduce(function(acc, cur) { return acc + entry.assignment[cur]; }, 0);
      if (!this.isAmountNull(balance)) {
        this.warn("accounting: balance is not zero ("+balance+") on sheet '"+entry.sheet+
                  "', row n°"+entry.row+": "+JSON.stringify(entry));
        if (!this.accounts[this.waitAccount]) {
          this.accounts[this.waitAccount] = { path: this.waitAccount };
        }
        entry.assignment[this.waitAccount] = -balance;
      }
    }
    this.sealedEntries = true;
  }
};

Accounting.prototype.isAmountNull = function(amount) {
  return Math.abs(amount) < 0.009;
};

////////////////////////////////////////////////////////////////////////////////

module.exports = Accounting;
