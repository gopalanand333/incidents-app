1. First deployment: cf deploy mta_archives/incident-management_1.0.0.mtar --strategy blue-green 

You can skip this step by using one of the following command line options:

--skip-testing-phase - you have to use it when starting the process.

--skip-idle-start - this option will also skip the start of the newly deployed applications on idle routes.

