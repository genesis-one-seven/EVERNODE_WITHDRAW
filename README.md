# Evernode monitor

This nodejs script (requires v20.11.1) will help you in the monitoring of your evernodes hosts. 


If you have many nodes, using this script you will have to check only one account instead of all of them.

It is made of 3 modules:

1. Move all EVRs from your node accounts to a single account.
2. Monitor the heartbeat of all your nodes and send an alert email in case no heartbeat was sent in the last N (configurable) minutes.
3. Send a few XAH to your Evernode accounts when the balance is below a certain threshold (configurable).

The hub accounts can be one of your evernode accounts or another one of your choice. 

The EVR destinaton account can be an exchange. 

## 1. Withdraw EVRs

This script cycles through your accounts, gets their EVR balance and sends all the EVRs balance to the configured EVR destination account. 

## 2. Monitor the heartbeat (not always working correctly)

This script cycles through your accounts and checks whether each account sent a heartbeat transaction in the last N (configurable) minutes. In case no heartbeat is found an alert email is sent to the configured email address. The alert email is repeated after N (configurable) minutes in case the down is not solved. A restore email is sent as soon as the issue is solved.

## 3. Send XAH to the account (and EVR to the reputation account) if balance is too low

As a minimum numer of XAH is required to run an evernode host, this script sends N (configurable) XAH from the first account when the balance is below a certain threshold (configurable). In case the first account balance is too low to send XAH, an alert email is sent to the configured email. This means you will only have to check the first account XAH balance and you can ignore the others that are automatically filled when needed.

The module also manages the reputation accounts XAH and EVR balance.  

## SMTP server

In order to send emails from the script you need an SMTP server. Follow these instruction to setup your free account in BREVO: https://www.programonaut.com/how-to-send-an-email-in-node-js-using-an-smtp-step-by-step/. 

## Install & run

First you need to ensure you have the latest version of node.js in your server (https://github.com/nodesource/distributions)

Then you can download and configure the script:

```
git clone https://github.com/genesis-one-seven/evernode_monitor/

cd evernode_monitor

cp .env.sample .env 

sudo nano .env
```

Set the variables in the .env file (all variables are described in the file) and then run the script:

```
npm install

node evernode_monitor.js
```

You can now setup a scheduled task that runs the script regularly using Cron.
The example below runs the transfer script every 30 minutes and logs the results to a file called log.log

crontab -e

0,30 * * * * /usr/bin/node /root/evernode_monitor/evernode_monitor.js >> /root/evernode_monitor/log.log

Cron documentation: https://www.cherryservers.com/blog/how-to-use-cron-to-automate-linux-jobs-on-ubuntu-20-04

## Update to last version

In order to update the script to the last version without losing your configuration, first go in evernode_monitor folder:

```
cd evernode_monitor
```

then give execute permission to the script:

```
chmod +x update.sh
```

and finally execute the script update.sh:

```
sudo ./update.sh
```

Here's the one line version of the command sequence:

```
cd evernode_monitor && chmod +x update.sh && sudo ./update.sh
```


## Use at your own risk. Double check your addresses before running the script!