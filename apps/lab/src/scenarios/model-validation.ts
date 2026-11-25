// ModelValidationReportV1 (LinkForge shadow validation) as the runtime returns it: validated against the synced source schema before the Lab shows it.
import Ajv from 'ajv';
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json' with {type:'json'};
import physicalSchema from '../shared/engineering-schemas/robot-physical-model-v1.schema.json' with {type:'json'};
import reportSchema from '../shared/engineering-schemas/model-validation-report-v1.schema.json' with {type:'json'};
import type {ModelValidationReportV1} from '../shared/navigation2d';
const ajv=new Ajv({strict:false,allErrors:true});
ajv.addSchema(componentSchema,'engineering-component.schema.json');ajv.addSchema(physicalSchema,'robot-physical-model-v1.schema.json');
export const validModelValidationReport=ajv.compile<ModelValidationReportV1>(reportSchema);
