output "public_ip" {
  description = "Elastic IP of the IncidentFlow server"
  value       = aws_eip.web.public_ip
}

output "store_url" {
  value = "http://${aws_eip.web.public_ip}/"
}

output "ops_console_url" {
  value = "http://${aws_eip.web.public_ip}/ops"
}

output "jenkins_url" {
  value = "http://${aws_eip.web.public_ip}:8080/"
}

output "ssh_command" {
  value = "ssh -i ansible/keys/${var.project}.pem ubuntu@${aws_eip.web.public_ip}"
}
