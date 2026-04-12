import mongoose from 'mongoose'

const DATA_TYPES = ['number', 'string', 'boolean']

const accountingParameterDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    label: { type: String, default: '' },
    description: { type: String, default: '' },
    dataType: { type: String, enum: DATA_TYPES, default: 'number' },
    /** suggested scope: global | department | user */
    allowedScopes: [{ type: String, enum: ['global', 'department', 'user'] }],
    defaultNumber: { type: Number, default: null },
    defaultString: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const AccountingParameterDefinition = mongoose.model(
  'AccountingParameterDefinition',
  accountingParameterDefinitionSchema,
)
export { DATA_TYPES as PARAM_DATA_TYPES }
