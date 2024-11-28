const { XrplClient } = require('xrpl-client')
const lib = require('xrpl-accountlib');
const { exit } = require('process');

const fs = require('fs')
const { createTransport } = require('nodemailer');


const path = require('path');
const { ALPN_ENABLED } = require('constants');
const { Console, log } = require('console');
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const verboseLog = process.env.verboseLog == "true";

const consoleLog = (msg) => {
  console.log(new Date().toISOString() + " " + msg)

}

const logVerbose = (msg) => {
  if (verboseLog) {
    consoleLog(msg)
  }
}

logVerbose("Original account string = " + process.env.accounts);
logVerbose("accounts length after split = " + process.env.accounts.split('\n').length);

const accounts = process.env.accounts.split('\n');

var reputationAccounts = [];
if (process.env.reputationAccounts != null)
  reputationAccounts = process.env.reputationAccounts.split('\n');

const evrDestinationAccount = process.env.evrDestinationAccount;

const evrDestinationAccountTag = process.env.evrDestinationAccountTag;

const xahSourceAccount = process.env.xahSourceAccount;
const xahSourceSecret = process.env.xahSourceSecret;

const run_evr_withdrawal = process.env.run_evr_withdrawal == "true";
const run_xah_balance_monitor = process.env.run_xah_balance_monitor == "true";
const run_heartbeat_monitor = process.env.run_heartbeat_monitor == "true";

const xahaud = process.env.xahaud;
const client = new XrplClient(xahaud);

const minutes_from_last_heartbeat_alert_threshold = process.env.minutes_from_last_heartbeat_alert_threshold;
const alert_repeat_interval_in_minutes = process.env.alert_repeat_interval_in_minutes;
const xah_balance_threshold = process.env.xah_balance_threshold * 1000000;
const evr_balance_threshold = process.env.evr_balance_threshold * 1;
const minimum_evr_transfer = process.env.minimum_evr_transfer * 1;
const refill_amount = process.env.refill_amount * 1000000;
const evr_refill_amount = process.env.evr_refill_amount * 1;

const smtpKey = process.env.smtpKey;
const smtpEmail = process.env.smtpEmail;

const destinationEmail = process.env.destinationEmail || process.env.smtpEmail;

const transporter = createTransport({
  host: "smtp-relay.sendinblue.com",
  port: 587,
  auth: {
    user: smtpEmail,
    pass: smtpKey,
  },
});


const heartbeatAccount = process.env.heartbeatAccount;

const myDate = new Date().toUTCString();


const monitor_balance = async () => {

  consoleLog("Monitoring the account XAH balance...");

  var sourceAccountId = accounts[0];
  var sourceAccount = null;
  var sequence = 0;

  var allAccounts = accounts.concat(reputationAccounts);

  logVerbose("accounts = " + allAccounts.length);
  for (const account of allAccounts) {

    if (account) {
      var accountNumber = getAccountNumber(account);
      logVerbose("Checking account " + accountNumber);
      const { account_data } = await client.send({ command: "account_info", account: accountNumber });

      var sourceData = await client.send({ command: "account_info", account: xahSourceAccount });

      var sequence = sourceData.account_data.Sequence;

      if (accountNumber != xahSourceAccount) {
        logVerbose("Balance for account " + accountNumber + " is " + account_data.Balance);
        if (parseInt(account_data.Balance) < xah_balance_threshold) {
          const filePath = path.resolve(__dirname, 'balanceLow-' + accountNumber + '.txt');
          consoleLog("Account balance for " + accountNumber + " is " + account_data.Balance + ", sending funds");
          consoleLog("Source account balance = " + sourceData.account_data.Balance);
          if (sourceData.account_data.Balance < xah_balance_threshold) {
            consoleLog("Not enough funds in first account to fill other accounts");
            if (!fs.existsSync(filePath)) {
              await sendMail("Insufficient funds", "We tried to send XAH to " + accountNumber + " but the balance in " + xahSourceAccount + " is too low.\r\n\r\nPlease feed your source account.");
              fs.writeFileSync(filePath, "Balance is too low");
            }
          }
          else {

            const tx = {
              TransactionType: 'Payment',
              Account: xahSourceAccount,  //Destination account is use to fillEvernode accounts
              Amount: (refill_amount).toString(),
              //Destination: 'rYourWalletYouControl'
              Destination: account_data.Account, //the account that has to be filled
              DestinationTag: "", //*** set to YOUR exchange wallet TAG Note: no quotes << do not forget to set TAG
              Fee: '12', //12 drops aka 0.000012 XAH, Note: Fee is XAH NOT EVR
              NetworkID: '21337', //XAHAU Production ID
              Sequence: sequence
            }

            lib.derive.familySeed(xahSourceSecret);
            var keypair = lib.derive.familySeed(xahSourceSecret)

            const { signedTransaction } = lib.sign(tx, keypair)

            consoleLog("sending the transaction " + JSON.stringify(tx));
            //SUBmit sign TX to ledger
            const submit = await client.send({ command: 'submit', 'tx_blob': signedTransaction })
            consoleLog(submit.engine_result, submit.engine_result_message, submit.tx_json.hash);

            if (fs.existsSync(filePath)) fs.rmSync(filePath);

            sequence++;

          }
        }

      }
    }
  }

  for (const account of reputationAccounts) {
    if (account) {
      var accountNumber = getAccountNumber(account);
      const { account_data } = await client.send({ command: "account_info", account: accountNumber });

      var sourceData = await client.send({ command: "account_info", account: xahSourceAccount });

      var sequence = sourceData.account_data.Sequence;

      if (account != xahSourceAccount) {
        var balance = await GetEvrBalance(accountNumber);
        var sourceBalance = await GetEvrBalance(xahSourceAccount);

        logVerbose("EVR Balance for account " + accountNumber + " is " + balance);
        logVerbose("EVR Balance for source account " + xahSourceAccount + " is " + sourceBalance);
        if (parseInt(balance) < evr_balance_threshold) {
          const filePath = path.resolve(__dirname, 'balanceLow-' + account + '.txt');

          consoleLog("Account EVR balance for " + accountNumber + " is " + balance + ", sending funds");

          if (sourceBalance < evr_refill_amount) {
            consoleLog("Not enough funds in first account to fill other accounts with EVR");
            logVerbose("sourceBalance in EVR " + sourceBalance);
            logVerbose("evr_refill_amount =  " + evr_refill_amount);
            if (!fs.existsSync(filePath)) {
              await sendMail("Insufficient EVR funds", "We tried to send EVR to " + accountNumber + " but the balance in " + xahSourceAccount + " is too low.\r\n\r\nPlease feed your source account.");
              fs.writeFileSync(filePath, "EVR Balance is too low");
            }
          }
          else {

            const tx = {
              TransactionType: 'Payment',
              Account: xahSourceAccount,  //Destination account is use to fillEvernode accounts
              Amount: {
                "currency": "EVR",
                "value": evr_refill_amount, //*** Change to balance (no quotes) or use "0.01" for testing low payment
                "issuer": "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" //DO NOT CHANGE - this is the EVR Trustline Issuer address
              },
              Destination: accountNumber, //the account that has to be filled
              DestinationTag: "", //*** set to YOUR exchange wallet TAG Note: no quotes << do not forget to set TAG
              Fee: '12', //12 drops aka 0.000012 XAH, Note: Fee is XAH NOT EVR
              NetworkID: '21337', //XAHAU Production ID
              Sequence: sequence
            }

            const { signedTransaction } = lib.sign(tx, keypair)

            consoleLog("sending the EVR transaction " + JSON.stringify(tx));
            //SUBmit sign TX to ledger
            const submit = await client.send({ command: 'submit', 'tx_blob': signedTransaction })
            consoleLog(submit.engine_result, submit.engine_result_message, submit.tx_json.hash);

            if (fs.existsSync(filePath)) fs.rmSync(filePath);

            sequence++;

          }
        }

      }
    }
  }
}

async function GetEvrBalance(account) {
  logVerbose("getting the EVR balance for " + account);
  let marker = ''
  const l = []
  var balance = 0
  while (typeof marker === 'string') {
    const lines = await client.send({ command: 'account_lines', account, marker: marker === '' ? undefined : marker })

    marker = lines?.marker === marker ? null : lines?.marker
    //consoleLog(`Got ${lines.lines.length} results`)
    lines.lines.forEach(t => {
      if (t.currency == "EVR") {
        logVerbose(JSON.stringify(t))

        balance = balance + t.balance
        logVerbose("EVR balance for account " + account + " increased by " + t.balance);
      }
    })
  }
  return balance;
}



const transfer_funds = async () => {
  consoleLog("Starting the funds transfer batch...");

  for (const account of accounts) {
    var accountNumber = getAccountNumber(account);
    if (account != "") {
      logVerbose("start the transferring process on account " + accountNumber);
      if (accountNumber != evrDestinationAccount) {
        logVerbose("getting account data on account " + accountNumber);
        const { account_data } = await client.send({ command: "account_info", account: accountNumber })

        let marker = ''
        const l = []
        var balance = 0
        while (typeof marker === 'string') {
          const lines = await client.send({ command: 'account_lines', account: accountNumber, marker: marker === '' ? undefined : marker })
          logVerbose(JSON.stringify(lines));
          marker = lines?.marker === marker ? null : lines?.marker
          //consoleLog(`Got ${lines.lines.length} results`)
          lines.lines.forEach(t => {
            if (t.currency == "EVR") {
              logVerbose(JSON.stringify(t))

              balance = balance + t.balance

            }
          })
        }

        //check just the EVRs balance is > 0 if not go to start of for loop with continue
        if (balance <= minimum_evr_transfer) {
          logVerbose('# EVR Balance is below the minumum required to send the funds for account ' + accountNumber); continue;
        }

        //balance = balance - 10;

        //Destination Adress and TAG set in.env file
        const tag = process.env.tag;

        //send all funds to your chosen Exchange, Xaman or other Xahau account 
        logVerbose("Balance = " + balance + ", preparing the payment transaction on account " + accountNumber);
        const tx = {
          TransactionType: 'Payment',
          Account: accountNumber,
          Amount: {
            "currency": "EVR",
            "value": balance, //*** Change to balance (no quotes) or use "0.01" for testing low payment
            "issuer": "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" //DO NOT CHANGE - this is the EVR Trustline Issuer address
          },
          //Destination: 'rYourWalletYouControl'
          Destination: evrDestinationAccount, //your exchnage or xaman wallet address
          DestinationTag: evrDestinationAccountTag, //*** set to YOUR exchange wallet TAG Note: no quotes << do not forget to set TAG
          Fee: '12', //12 drops aka 0.000012 XAH, Note: Fee is XAH NOT EVR
          NetworkID: '21337', //XAHAU Production ID
          Sequence: account_data.Sequence
        }
        logVerbose("signing the transaction on account " + accountNumber);
        
        lib.derive.familySeed(getAccountSecret(account));
        var keypair = lib.derive.familySeed(getAccountSecret(account))

        
        const { signedTransaction } = lib.sign(tx, keypair)
        logVerbose(JSON.stringify(tx))

        //SUBmit sign TX to ledger
        consoleLog("sending the EVR payment transaction on account " + accountNumber);
        const submit = await client.send({ command: 'submit', 'tx_blob': signedTransaction })
        consoleLog("Payment sent, result = " + submit.engine_result);


      } //end of for loop
    }
  }
}

const monitor_heartbeat = async () => {
  consoleLog("Checking account heartbeat...");
  var accountIndex = 1;
  for (const account of accounts) {
    logVerbose("checking account heartbeat on account " + account);
    await checkAccountHeartBeat(getAccountNumber(account), accountIndex);
    accountIndex++;
  }
}

function getMinutesBetweenDates(startDate, endDate) {
  const diff = endDate - startDate;
  return (diff / 60000);
}

function getAccountNumber(account)
{
  return account.split(" ")[2]
}

function getAccountSecret(account)
{
  return account.split(" ")[1]
}



async function checkAccountHeartBeat(account, accountIndex) {
  var ledgerIndex = -1;
  const filePath = path.resolve(__dirname, account + '.txt');
  var accountFailed = fs.existsSync(filePath);
  var date_failure = new Date();
  if (accountFailed) {
    date_failure = new Date(Date.parse(fs.readFileSync(filePath, 'utf8')));
    logVerbose("account " + account + " is in status failed since " + date_failure);
    const diffMinutes = getMinutesBetweenDates(date_failure, new Date());
    logVerbose("diffMinutes = " + diffMinutes);
    logVerbose("alert_repeat_interval_in_minutes = " + alert_repeat_interval_in_minutes);
    if (alert_repeat_interval_in_minutes > 0 && diffMinutes > alert_repeat_interval_in_minutes) {
      accountFailed = false;
    }
  }

  while (true) {
    let marker = '';
    const l = [];
    while (typeof marker === 'string') {
      logVerbose("getting last 5 transactions on account " + account + " with last ledger " + ledgerIndex);
      const response = await client.send({
        "id": 2,
        "command": "account_tx",
        "account": account,
        "ledger_index_min": -1,
        "ledger_index_max": ledgerIndex,
        "binary": false,
        "limit": 5,
        "forward": false, marker: marker === '' ? undefined : marker
      })
      marker = response?.marker === marker ? null : response?.marker
      // It gets the last 5 transactions and looks for the last heartbeat
      var i = 0;
      if (response.transactions != undefined) {
        for (var tIndex = 0; tIndex < response.transactions.length; tIndex++) {
          var transaction = response.transactions[tIndex];
          ledgerIndex = transaction.tx.ledger_index - 1;
          logVerbose(JSON.stringify(transaction.tx));
          logVerbose(tIndex + " " + 2 + " new ledgerIndex = " + ledgerIndex);
          var utcMilliseconds = 1000 * (transaction.tx.date + 946684800);
          var transactionDate = new Date(0); // The 0 there is the key, which sets the date to the epoch
          var date = new Date();
          var now_utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(),
            date.getUTCDate(), date.getUTCHours(),
            date.getUTCMinutes(), date.getUTCSeconds());
          if (now_utc - utcMilliseconds > 1000 * 60 * minutes_from_last_heartbeat_alert_threshold) {
            consoleLog("Handling failure for too old heartbeat transaction, account failed = " + accountFailed);
            await handleFailure(account, accountFailed, filePath, accountIndex);
            return;
          }
          if (transaction.tx.Destination == heartbeatAccount) {
            //consoleLog("System running regularly " + account + "");
            if (fs.existsSync(filePath)) {
              await sendSuccess(account, accountIndex);
              fs.rmSync(filePath);
            }
            return;
          }
        }
        if (response.transactions.length < 5) {
          consoleLog("Handling failure for no heartbeat transactions, account failed = " + accountFailed);
          await handleFailure(account, accountFailed, filePath);
          return;
        }
      }
    }
  }
}

async function handleFailure(account, accountFailed, filePath, accountIndex) {
  if (!accountFailed) {
    await sendFailure(account, accountIndex);
    fs.writeFileSync(filePath, new Date().toString())
  }
  consoleLog("ALERT, SYSTEM STOPPED " + account);
}

async function sendFailure(account, accountIndex) {
  var subject = "Failure in Evernode heartbeat " + accountIndex.toString();
  var text = "Failure in retrieving Evernode heartbeat for account " + account + " (" + accountIndex.toString() + ")";
  await sendMail(subject, text);
}

async function sendSuccess(account, accountIndex) {
  var subject = "Evernode heartbeat restored " + accountIndex.toString();
  var text = "Evernode heartbeat restored in account " + account + " (" + accountIndex.toString() + ")";
  await sendMail(subject, text);
}

async function sendMail(subject, text) {
  var mailOptions = {
    from: smtpEmail,
    to: destinationEmail,
    subject: subject,
    text: text
  };
  consoleLog("SENDING MAIL " + JSON.stringify(mailOptions));

  if (!smtpEmail) {
    consoleLog("smtp email not set in .env file. Email is not sent");
    return;
  }

  await transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      consoleLog(error);
    } else {
      consoleLog('Email sent: ' + info.response);
    }
  });
}

function validate() {
  if (!accounts || accounts.length == 0 || accounts[0] == "") {
    consoleLog("no accounts set in .env file.");
    return false;
  }
  
  return true;
}

const main = async () => {
  var valid = validate();
  if (valid) {
    if (run_evr_withdrawal) { await transfer_funds() };
    if (run_heartbeat_monitor) await monitor_heartbeat();
    if (run_xah_balance_monitor) await monitor_balance();
  }
  client.close();
  consoleLog('Shutting down...');
  // Workaround so all queued emails are sent. 
  // I had to explicitly call the exit() function as the application was not stopping 
  // in case of Xahaud request failure, I don't know why. 
  setTimeout(function () {
    exit();
  }, 10000);
};

main()