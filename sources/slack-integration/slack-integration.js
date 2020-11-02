const gorgias = require('../../gorgias.app.js')
const slack = require('../../slack.app.js')
const moment = require('moment')
const axios = require('axios')
const { WebClient } = require('@slack/web-api')

module.exports = {
  key: "gorgias-slack-integration",
  name: "Gorgias Slack Integrtion",
  description: "Post new messages to Slack",
  version: "0.0.1",
  props: {
    db: "$.service.db",
    http: "$.interface.http",
    gorgias,
    slack,
    channel: {
      type: "string",
      label: "Channels",
      description: "Select one or more channels to send new messages.",
      optional: true,
      async options({ prevContext }) {
        let { types, cursor, userNames } = prevContext
        if (types == null) {
          const scopes = await this.slack.scopes()
          types = ["public_channel"]
          if (scopes.includes("groups:read")) {
            types.push("private_channel")
          }
          if (scopes.includes("mpim:read")) {
            types.push("mpim")
          }
          if (scopes.includes("im:read")) {
            types.push("im")
            // TODO use paging
            userNames = {}
            for (const user of (await this.slack.users()).users) {
              userNames[user.id] = user.name
            }
          }
        }
        const resp = await this.slack.availableConversations(types.join(), cursor)
        return {
          options: resp.conversations.map((c) => {
            if (c.is_im) {
              return { label: `Direct messaging with: @${userNames[c.user]}`, value: c.id }
            } else if (c.is_mpim) {
              return { label: c.purpose.value, value: c.id }
            } else {
              return { label: `${c.is_private ? "Private" : "Public"} channel: ${c.name}`, value: c.id }
            }
          }),
          context: { types, cursor: resp.cursor, userNames },
        }
      },
    },
  },
  hooks: {
    async activate() {
      const result = await axios({
        url: `https://pipedream.gorgias.com/api/integrations/`,
        method: `post`,
        auth: {
          username: `${this.gorgias.$auth.email}`,
          password: `${this.gorgias.$auth.api_key}`,
        },
        data: {
          "type": "http",
          "name": "Pipedream Slack Integration",
          "description": "",
          "http": {
            "headers": {},
            "url": this.http.endpoint,
            "method": "POST",
            "request_content_type": "application/json",
            "response_content_type": "application/json",
            "triggers": {
              "ticket-created": true,
              "ticket-updated": false,
              "ticket-message-created": false
            },
            "form": {
              "ticket_id": "{{ticket.id}}",
              "ticket_customer_name": "{{ticket.customer.name}}",
              "ticket_message": "{{ticket.first_message.body_text}}",
              "ticket_subject": "{{ticket.subject}}",
              "ticket_customer_name": "{{ticket.customer.name}}",
              "ticket_account_domain": "{{ticket.account.domain}}"
            },
          },
        }
      })
      this.db.set('hookId', result.data.id)
    },
    async deactivate() {
      const result = await axios({
        url: `https://${this.gorgias.$auth.domain}.gorgias.com/api/integrations/${this.db.get('hookId')}/`,
        method: `delete`,
        auth: {
          username: `${this.gorgias.$auth.email}`,
          password: `${this.gorgias.$auth.api_key}`,
        },
      })
    },
  },
  async run(event) {
    console.log(event)
    console.log(`slack channel: ${this.channel}`)
    try {
      const web = new WebClient(this.slack.$auth.oauth_access_token)
      const response = await web.chat.postMessage({
        "text": `New ticket <https://${event.body.ticket_account_domain}.gorgias.com/app/ticket/${event.body.ticket_id}|*${event.body.ticket_subject}*> from *${event.body.ticket_customer_name}*`,
        "attachments": [
            {
                "text": `${event.body.ticket_message}`,
                "title": `${event.body.ticket_subject}`,
                "title_link": `https://${event.body.ticket_account_domain}.gorgias.com/app/ticket/${event.body.ticket_id}`
            }
        ],
        channel: this.channel,
      })
    } catch (err) {
      this.error = err
      throw err
    }
  },
}
