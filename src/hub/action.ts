import * as fs from "fs"
import * as path from "path"
import {ExecuteProcessQueue} from "../xpc/execute_process_queue"

import * as winston from "winston"
import {
  ActionDownloadSettings,
  ActionForm,
  ActionFormat,
  ActionFormatting,
  ActionRequest,
  ActionResponse,
  ActionType,
  ActionVisualizationFormatting,
} from "."

const datauri = require("datauri")

export interface ActionParameter {
  name: string
  label: string
  required: boolean
  sensitive: boolean
  description?: string
}

export interface RequiredField {
  tag?: string
  any_tag?: string[]
  all_tags?: string[]
}

export interface Action {
  execute(request: ActionRequest): Promise<ActionResponse>
  form?(request: ActionRequest): Promise<ActionForm>
}

export interface RouteBuilder {
  actionUrl(action: Action): string
  formUrl(action: Action): string
}

export abstract class Action {

  abstract name: string
  abstract label: string
  abstract description: string
  usesStreaming = false
  executeInOwnProcess = false
  iconName?: string

  // Default to the earliest version of Looker with support for the Action API
  minimumSupportedLookerVersion = "5.5.0"

  abstract supportedActionTypes: ActionType[]
  supportedFormats?: ActionFormat[]
  supportedFormattings?: ActionFormatting[]
  supportedVisualizationFormattings?: ActionVisualizationFormatting[]
  requiredFields?: RequiredField[] = []

  abstract params: ActionParameter[]

  asJson(router: RouteBuilder) {
    return {
      description: this.description,
      form_url: this.form ? router.formUrl(this) : null,
      label: this.label,
      name: this.name,
      params: this.params,
      required_fields: this.requiredFields,
      supported_action_types: this.supportedActionTypes,
      supported_formats: this.supportedFormats,
      supported_formattings: this.supportedFormattings,
      supported_visualization_formattings: this.supportedVisualizationFormattings,
      supported_download_settings: (
        this.usesStreaming
          ?
            [ActionDownloadSettings.Url]
          :
            [ActionDownloadSettings.Push]
      ),
      icon_data_uri: this.getImageDataUri(),
      url: router.actionUrl(this),
    }
  }

  async validateAndExecute(request: ActionRequest, queue?: ExecuteProcessQueue) {
    if (this.supportedActionTypes.indexOf(request.type) === -1) {
      const types = this.supportedActionTypes.map((at) => `"${at}"`).join(", ")
      if (request.type as any) {
        throw `This action does not support requests of type "${request.type}". The request must be of type: ${types}.`
      } else {
        throw `No request type specified. The request must be of type: ${types}.`
      }
    }

    this.throwForMissingRequiredParameters(request)

    if (
      this.usesStreaming &&
      !(request.attachment || (request.scheduledPlan && request.scheduledPlan.downloadUrl))
    ) {
      throw "A streaming action was sent incompatible data. The action must have a download url or an attachment."
    }

    if (this.executeInOwnProcess) {
      if (!queue) {
        throw "An action marked for being executed on a separate process needs a ExecuteProcessQueue."
      }
      request.actionId = this.name
      return new Promise<ActionResponse>((resolve, reject) => {
        queue.run(JSON.stringify(request)).then((response: string) => {
          const actionResponse = new ActionResponse()
          Object.assign(actionResponse, response)
          resolve(actionResponse)
        }).catch((err) => {
          winston.error(JSON.stringify(err))
          reject(err)
        })
      })
    } else {
      return this.execute(request)
    }

  }

  async validateAndFetchForm(request: ActionRequest) {
    try {
      this.throwForMissingRequiredParameters(request)
    } catch (e) {
      const errorForm = new ActionForm()
      errorForm.error = e
      return errorForm
    }
    return this.form!(request)
  }

  get hasForm() {
    return !!this.form
  }

  private throwForMissingRequiredParameters(request: ActionRequest) {
    const requiredParams = this.params.filter((p) => p.required)

    if (requiredParams.length > 0) {
      for (const p of requiredParams) {
        const param = request.params[p.name]
        if (!param) {
          throw `Required setting "${p.label}" not specified in action settings.`
        }
      }
    }
  }

  private getImageDataUri() {
    if (!this.iconName) {
      return null
    }
    const iconPath = path.resolve(__dirname, "..", "actions", this.iconName)
    if (fs.existsSync(iconPath)) {
      return new datauri(iconPath).content
    }
    return null
  }

}
